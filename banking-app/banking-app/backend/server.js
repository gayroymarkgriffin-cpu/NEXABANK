const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexabank_secret_key_change_in_production';
const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'NEXAADMIN2025';

// Email config (set these in Render environment variables)
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const BANK_NAME = process.env.BANK_NAME || 'NexaBank';
const BANK_URL = process.env.BANK_URL || 'https://nexabank.onrender.com';

// MTN Mobile Money config (sandbox by default)
const MTN_BASE_URL = process.env.MTN_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const MTN_API_KEY = process.env.MTN_API_KEY || 'sandbox_key';
const MTN_SUBSCRIPTION_KEY = process.env.MTN_SUBSCRIPTION_KEY || '';
const ORANGE_BASE_URL = process.env.ORANGE_BASE_URL || 'https://api.orange.com/orange-money-webpay/dev/v1';
const ORANGE_AUTH_HEADER = process.env.ORANGE_AUTH_HEADER || '';

// ---- MIDDLEWARE ----
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ---- FILE UPLOAD (KYC) ----
const uploadDir = path.join(__dirname, '../uploads/kyc');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `kyc_${req.user?.id || 'unknown'}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG, PNG, PDF files allowed'));
  }
});

// Serve KYC uploads (admin only in production)
app.use('/uploads/kyc', express.static(uploadDir));

// ---- DATABASE ----
const dbDir = path.join(__dirname, '../database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new sqlite3.Database(path.join(dbDir, 'nexabank.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    phone TEXT, password TEXT NOT NULL, balance REAL DEFAULT 5000.00,
    is_admin INTEGER DEFAULT 0, is_blocked INTEGER DEFAULT 0,
    kyc_status TEXT DEFAULT 'pending',
    kyc_doc TEXT,
    kyc_doc_type TEXT,
    kyc_submitted_at TEXT,
    kyc_reviewed_at TEXT,
    kyc_notes TEXT,
    email_verified INTEGER DEFAULT 0,
    last_login TEXT,
    joined TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    type TEXT NOT NULL, amount REAL NOT NULL, note TEXT,
    icon TEXT DEFAULT '💳', status TEXT DEFAULT 'completed',
    date TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS mobile_money (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    provider TEXT NOT NULL, phone TEXT NOT NULL,
    amount REAL NOT NULL, type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    reference TEXT, external_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    amount REAL NOT NULL, tenure INTEGER NOT NULL,
    purpose TEXT, details TEXT, income REAL,
    interest_rate REAL DEFAULT 0.05,
    interest REAL, total_repayment REAL, monthly_payment REAL,
    amount_paid REAL DEFAULT 0,
    schedule TEXT DEFAULT "[]",
    status TEXT DEFAULT "pending",
    admin_note TEXT, rejection_reason TEXT,
    applied_at TEXT DEFAULT (datetime("now")),
    approved_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    title TEXT NOT NULL, message TEXT NOT NULL,
    type TEXT DEFAULT 'info', read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Seed demo user
  db.get('SELECT id FROM users WHERE email = ?', ['demo@nexabank.com'], (err, row) => {
    if (!row) {
      const hashed = bcrypt.hashSync('demo1234', 10);
      db.run(`INSERT INTO users (id,name,email,phone,password,balance,kyc_status,email_verified) VALUES (?,?,?,?,?,?,?,?)`,
        ['demo_001','John Doe','demo@nexabank.com','+237 600 000 000',hashed,12450.00,'approved',1]);
      const txs = [
        ['tx1','demo_001','Alice Johnson','credit',3250.00,'Freelance payment','💼'],
        ['tx2','demo_001','Netflix','debit',15.99,'Monthly plan','🎬'],
        ['tx3','demo_001','Salary - TechCorp','credit',4500.00,'Monthly salary','🏢'],
        ['tx4','demo_001','Rent Payment','debit',850.00,'Apartment rent','🏠'],
        ['tx5','demo_001','Jean Kamga','credit',120.00,'Lunch split','🍽️'],
        ['tx6','demo_001','Amazon','debit',67.49,'Electronics','📦'],
      ];
      txs.forEach(tx => db.run(`INSERT INTO transactions (id,user_id,name,type,amount,note,icon) VALUES (?,?,?,?,?,?,?)`, tx));
      console.log('✅ Demo user seeded');
    }
  });
});

// ---- EMAIL SERVICE ----
function createTransporter() {
  if (!EMAIL_USER || !EMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
}

function emailTemplate(title, body) {
  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"/><style>
    body { font-family: 'Segoe UI', sans-serif; background: #f4f6f9; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #0A1628, #162845); padding: 32px; text-align: center; }
    .header h1 { color: #D4AF37; font-size: 24px; margin: 0; letter-spacing: 1px; }
    .header p { color: rgba(255,255,255,0.5); font-size: 13px; margin: 6px 0 0; }
    .body { padding: 36px 32px; }
    .body h2 { color: #0A1628; font-size: 20px; margin-bottom: 16px; }
    .body p { color: #555; font-size: 15px; line-height: 1.7; margin-bottom: 16px; }
    .highlight { background: #f8f5e6; border-left: 4px solid #D4AF37; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 20px 0; }
    .highlight strong { color: #0A1628; font-size: 18px; }
    .btn { display: inline-block; background: #D4AF37; color: #0A1628; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; margin: 8px 0; }
    .footer { background: #f8f9fa; padding: 20px 32px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #eee; }
  </style></head>
  <body>
    <div class="container">
      <div class="header">
        <h1>⬡ ${BANK_NAME}</h1>
        <p>Secure Banking Platform</p>
      </div>
      <div class="body">
        <h2>${title}</h2>
        ${body}
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} ${BANK_NAME}. All rights reserved.</p>
        <p>This is an automated message. Please do not reply.</p>
      </div>
    </div>
  </body>
  </html>`;
}

async function sendEmail(to, subject, title, body) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`📧 Email skipped (not configured): ${subject} → ${to}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"${BANK_NAME}" <${EMAIL_USER}>`,
      to, subject,
      html: emailTemplate(title, body)
    });
    console.log(`📧 Email sent: ${subject} → ${to}`);
  } catch (err) {
    console.error('📧 Email error:', err.message);
  }
}

// ---- NOTIFICATION HELPER ----
function addNotification(userId, title, message, type = 'info') {
  const id = 'notif_' + Date.now() + Math.random().toString(36).slice(2,6);
  db.run(`INSERT INTO notifications (id,user_id,title,message,type) VALUES (?,?,?,?,?)`,
    [id, userId, title, message, type]);
}

// ---- AUTH MIDDLEWARE ----
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.is_admin) return res.status(403).json({ error: 'Admin access required' });
    req.user = decoded; next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ============================
// ---- USER ROUTES ----
// ============================

// REGISTER
app.post('/api/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password too short' });

  db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
    if (row) return res.status(409).json({ error: 'Email already registered' });
    const id = 'usr_' + Date.now();
    const hashed = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO users (id,name,email,phone,password,kyc_status) VALUES (?,?,?,?,?,?)`,
      [id, name, email, phone||'', hashed, 'pending'], async (err) => {
        if (err) return res.status(500).json({ error: 'Registration failed' });

        // Welcome email
        await sendEmail(email, `Welcome to ${BANK_NAME}!`, `Welcome, ${name}! 🎉`,
          `<p>Your account has been created successfully.</p>
          <div class="highlight"><strong>Next step:</strong> Please complete your KYC verification by uploading a valid ID to activate full account features.</div>
          <p><a href="${BANK_URL}/pages/kyc.html" class="btn">Complete KYC →</a></p>
          <p>Demo login: <strong>demo@nexabank.com</strong> / <strong>demo1234</strong></p>`
        );

        // Admin notification
        addNotification(id, '🎉 Account Created', 'Welcome to ' + BANK_NAME + '! Please complete your KYC verification.', 'info');

        const token = jwt.sign({ id, email, name, is_admin: false }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id, name, email, balance: 5000.00, kyc_status: 'pending' } });
      });
  });
});

// LOGIN
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_blocked) return res.status(403).json({ error: 'Account blocked. Contact support.' });

    // Update last login
    db.run('UPDATE users SET last_login=? WHERE id=?', [new Date().toISOString(), user.id]);

    // Login notification email
    await sendEmail(user.email, `New login to your ${BANK_NAME} account`, 'New Login Detected',
      `<p>Hi ${user.name},</p>
      <p>A new login was detected on your account.</p>
      <div class="highlight"><strong>Time:</strong> ${new Date().toLocaleString()}</div>
      <p>If this wasn't you, please contact support immediately.</p>`
    );

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, is_admin: !!user.is_admin },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, balance: user.balance, is_admin: !!user.is_admin, kyc_status: user.kyc_status } });
  });
});

// ME
app.get('/api/me', authMiddleware, (req, res) => {
  db.get('SELECT id,name,email,phone,balance,joined,is_admin,kyc_status,last_login FROM users WHERE id=?', [req.user.id], (err, user) => {
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  });
});

app.put('/api/me', authMiddleware, (req, res) => {
  const { name, phone } = req.body;
  db.run('UPDATE users SET name=?,phone=? WHERE id=?', [name,phone,req.user.id]);
  res.json({ success: true });
});

// TRANSACTIONS
app.get('/api/transactions', authMiddleware, (req, res) => {
  db.all('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC', [req.user.id], (err, rows) => {
    res.json(rows || []);
  });
});

// SEND MONEY
app.post('/api/send', authMiddleware, async (req, res) => {
  const { to, amount, note } = req.body;
  if (!to || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid request' });

  db.get('SELECT * FROM users WHERE id=?', [req.user.id], async (err, user) => {
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.kyc_status !== 'approved') return res.status(403).json({ error: 'KYC verification required to send money' });
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient funds' });

    db.run('UPDATE users SET balance=balance-? WHERE id=?', [amount, req.user.id]);
    const txId = 'tx_' + Date.now();
    db.run(`INSERT INTO transactions (id,user_id,name,type,amount,note,icon) VALUES (?,?,?,?,?,?,?)`,
      [txId, req.user.id, to, 'debit', amount, note||'Transfer', '📤']);

    // Email alert
    await sendEmail(user.email, `Money Sent — ${BANK_NAME}`, 'Transfer Successful 📤',
      `<p>Hi ${user.name},</p>
      <p>Your transfer has been processed successfully.</p>
      <div class="highlight">
        <strong>Amount Sent: $${parseFloat(amount).toFixed(2)}</strong><br/>
        <span style="color:#666; font-size:14px;">To: ${to}</span><br/>
        <span style="color:#666; font-size:14px;">Note: ${note || 'Transfer'}</span>
      </div>
      <p>If you did not authorize this transaction, contact support immediately.</p>`
    );

    addNotification(req.user.id, '📤 Money Sent', `You sent $${parseFloat(amount).toFixed(2)} to ${to}`, 'debit');

    db.get('SELECT balance FROM users WHERE id=?', [req.user.id], (err, u) => {
      res.json({ success: true, newBalance: u.balance, txId });
    });
  });
});

// NOTIFICATIONS
app.get('/api/notifications', authMiddleware, (req, res) => {
  db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20', [req.user.id], (err, rows) => {
    res.json(rows || []);
  });
});

app.put('/api/notifications/read', authMiddleware, (req, res) => {
  db.run('UPDATE notifications SET read=1 WHERE user_id=?', [req.user.id]);
  res.json({ success: true });
});

// ============================
// ---- KYC ROUTES ----
// ============================

// Submit KYC
app.post('/api/kyc/submit', authMiddleware, upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No document uploaded' });
  const { doc_type } = req.body;

  db.run(`UPDATE users SET kyc_doc=?, kyc_doc_type=?, kyc_status=?, kyc_submitted_at=? WHERE id=?`,
    [req.file.filename, doc_type||'id', 'submitted', new Date().toISOString(), req.user.id], async (err) => {
      if (err) return res.status(500).json({ error: 'KYC submission failed' });

      // Email user
      db.get('SELECT name, email FROM users WHERE id=?', [req.user.id], async (err, user) => {
        await sendEmail(user.email, `KYC Submitted — ${BANK_NAME}`, 'KYC Document Received ✅',
          `<p>Hi ${user.name},</p>
          <p>We have received your KYC document and it is currently under review.</p>
          <div class="highlight"><strong>Status: Under Review</strong><br/><span style="color:#666; font-size:14px;">We will notify you within 24 hours.</span></div>
          <p>Thank you for your patience.</p>`
        );
        addNotification(req.user.id, '📋 KYC Submitted', 'Your document is under review. We will notify you within 24 hours.', 'info');
      });

      res.json({ success: true, message: 'KYC submitted successfully' });
    });
});

// Get KYC status
app.get('/api/kyc/status', authMiddleware, (req, res) => {
  db.get('SELECT kyc_status, kyc_doc_type, kyc_submitted_at, kyc_reviewed_at, kyc_notes FROM users WHERE id=?',
    [req.user.id], (err, row) => {
      res.json(row || { kyc_status: 'pending' });
    });
});

// ============================
// ---- MOBILE MONEY ROUTES ----
// ============================

// Deposit via MTN Mobile Money
app.post('/api/mobilemoney/deposit', authMiddleware, async (req, res) => {
  const { phone, amount, provider } = req.body;
  if (!phone || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid request' });

  const mmId = 'mm_' + Date.now();
  const externalId = 'nexa_' + Date.now();

  // Save pending transaction
  db.run(`INSERT INTO mobile_money (id,user_id,provider,phone,amount,type,status,external_id) VALUES (?,?,?,?,?,?,?,?)`,
    [mmId, req.user.id, provider||'mtn', phone, amount, 'deposit', 'pending', externalId]);

  try {
    if (provider === 'mtn' && MTN_SUBSCRIPTION_KEY) {
      // Real MTN MoMo API call
      const tokenRes = await axios.post(`${MTN_BASE_URL}/collection/token/`, {}, {
        headers: {
          'Authorization': `Basic ${Buffer.from(MTN_API_KEY).toString('base64')}`,
          'Ocp-Apim-Subscription-Key': MTN_SUBSCRIPTION_KEY
        }
      });
      const accessToken = tokenRes.data.access_token;

      await axios.post(`${MTN_BASE_URL}/collection/v1_0/requesttopay`, {
        amount: amount.toString(),
        currency: 'XAF',
        externalId,
        payer: { partyIdType: 'MSISDN', partyId: phone },
        payerMessage: `Deposit to ${BANK_NAME}`,
        payeeNote: `Account deposit`
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-Reference-Id': externalId,
          'X-Target-Environment': 'sandbox',
          'Ocp-Apim-Subscription-Key': MTN_SUBSCRIPTION_KEY,
          'Content-Type': 'application/json'
        }
      });

      db.run('UPDATE mobile_money SET status=? WHERE id=?', ['processing', mmId]);
      res.json({ success: true, status: 'processing', message: 'Check your phone to approve the payment', reference: externalId });

    } else {
      // SANDBOX MODE — simulate success after 3 seconds
      setTimeout(async () => {
        db.run('UPDATE mobile_money SET status=?,updated_at=? WHERE id=?',
          ['completed', new Date().toISOString(), mmId]);
        db.run('UPDATE users SET balance=balance+? WHERE id=?', [amount, req.user.id]);
        db.run(`INSERT INTO transactions (id,user_id,name,type,amount,note,icon) VALUES (?,?,?,?,?,?,?)`,
          ['tx_'+Date.now(), req.user.id, `${provider?.toUpperCase()||'MTN'} Mobile Money`, 'credit', amount, `Mobile money deposit from ${phone}`, '📱']);

        db.get('SELECT name,email FROM users WHERE id=?', [req.user.id], async (err, user) => {
          if (user) {
            await sendEmail(user.email, `Deposit Received — ${BANK_NAME}`, 'Mobile Money Deposit ✅',
              `<p>Hi ${user.name},</p>
              <p>Your mobile money deposit has been received.</p>
              <div class="highlight"><strong>Amount: $${parseFloat(amount).toFixed(2)}</strong><br/>
              <span style="color:#666; font-size:14px;">From: ${phone} (${provider?.toUpperCase()||'MTN'})</span></div>`
            );
            addNotification(req.user.id, '📱 Deposit Received', `$${amount} deposited via mobile money from ${phone}`, 'credit');
          }
        });
      }, 3000);

      res.json({ success: true, status: 'processing', message: '🧪 Sandbox mode: deposit will complete in 3 seconds', reference: externalId });
    }

  } catch (err) {
    console.error('MoMo error:', err.message);
    db.run('UPDATE mobile_money SET status=? WHERE id=?', ['failed', mmId]);
    res.status(500).json({ error: 'Mobile money request failed: ' + err.message });
  }
});

// Withdraw to MTN Mobile Money
app.post('/api/mobilemoney/withdraw', authMiddleware, async (req, res) => {
  const { phone, amount, provider } = req.body;
  if (!phone || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid request' });

  db.get('SELECT * FROM users WHERE id=?', [req.user.id], async (err, user) => {
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.kyc_status !== 'approved') return res.status(403).json({ error: 'KYC required to withdraw' });
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient funds' });

    const mmId = 'mm_' + Date.now();
    db.run(`INSERT INTO mobile_money (id,user_id,provider,phone,amount,type,status) VALUES (?,?,?,?,?,?,?)`,
      [mmId, req.user.id, provider||'mtn', phone, amount, 'withdrawal', 'pending']);

    // Deduct immediately
    db.run('UPDATE users SET balance=balance-? WHERE id=?', [amount, req.user.id]);
    db.run(`INSERT INTO transactions (id,user_id,name,type,amount,note,icon) VALUES (?,?,?,?,?,?,?)`,
      ['tx_'+Date.now(), req.user.id, `Withdrawal to ${phone}`, 'debit', amount, `Mobile money withdrawal`, '📱']);

    // Sandbox: mark complete
    setTimeout(async () => {
      db.run('UPDATE mobile_money SET status=?,updated_at=? WHERE id=?', ['completed', new Date().toISOString(), mmId]);
      await sendEmail(user.email, `Withdrawal Processed — ${BANK_NAME}`, 'Withdrawal Successful 💸',
        `<p>Hi ${user.name},</p>
        <p>Your withdrawal has been processed.</p>
        <div class="highlight"><strong>Amount: $${parseFloat(amount).toFixed(2)}</strong><br/>
        <span style="color:#666; font-size:14px;">To: ${phone} (${provider?.toUpperCase()||'MTN'})</span></div>`
      );
      addNotification(req.user.id, '💸 Withdrawal Sent', `$${amount} sent to ${phone} via mobile money`, 'debit');
    }, 3000);

    res.json({ success: true, status: 'processing', message: '🧪 Sandbox: withdrawal will complete in 3 seconds' });
  });
});

// Mobile money history
app.get('/api/mobilemoney/history', authMiddleware, (req, res) => {
  db.all('SELECT * FROM mobile_money WHERE user_id=? ORDER BY created_at DESC', [req.user.id], (err, rows) => {
    res.json(rows || []);
  });
});

// ============================
// ---- ADMIN ROUTES ----
// ============================

// Admin setup
app.post('/api/admin/setup', (req, res) => {
  const { name, email, password, setupKey } = req.body;
  if (setupKey !== ADMIN_SETUP_KEY) return res.status(403).json({ error: 'Invalid setup key' });
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Invalid data' });
  db.get('SELECT id FROM users WHERE is_admin=1', [], (err, existing) => {
    if (existing) return res.status(409).json({ error: 'Admin already exists' });
    const id = 'admin_' + Date.now();
    const hashed = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO users (id,name,email,phone,password,balance,is_admin,kyc_status) VALUES (?,?,?,?,?,?,?,?)`,
      [id,name,email,'',hashed,0,1,'approved'], (err) => {
        if (err) return res.status(500).json({ error: 'Setup failed: '+err.message });
        res.json({ success: true });
      });
  });
});

// All users
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  db.all('SELECT id,name,email,phone,balance,is_admin,is_blocked,kyc_status,kyc_doc,kyc_doc_type,kyc_submitted_at,joined FROM users ORDER BY joined DESC', [], (err, rows) => {
    res.json(rows || []);
  });
});

// Single user
app.get('/api/admin/users/:id', adminMiddleware, (req, res) => {
  db.get('SELECT * FROM users WHERE id=?', [req.params.id], (err, user) => {
    if (!user) return res.status(404).json({ error: 'Not found' });
    db.all('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC', [req.params.id], (err, txs) => {
      const { password, ...safeUser } = user;
      res.json({ ...safeUser, transactions: txs || [] });
    });
  });
});

// Block/unblock
app.put('/api/admin/users/:id/block', adminMiddleware, async (req, res) => {
  const { block } = req.body;
  db.run('UPDATE users SET is_blocked=? WHERE id=?', [block?1:0, req.params.id], async (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.get('SELECT name,email FROM users WHERE id=?', [req.params.id], async (err, user) => {
      if (user) {
        const action = block ? 'blocked' : 'unblocked';
        await sendEmail(user.email, `Account ${action} — ${BANK_NAME}`, `Your account has been ${action}`,
          `<p>Hi ${user.name},</p><p>Your account has been <strong>${action}</strong>.</p>
          ${block ? '<p>Please contact support for more information.</p>' : '<p>You can now log in normally.</p>'}`
        );
        addNotification(req.params.id, block ? '🚫 Account Blocked' : '✅ Account Unblocked',
          block ? 'Your account has been blocked. Contact support.' : 'Your account has been unblocked.', block ? 'warning' : 'success');
      }
    });
    res.json({ success: true });
  });
});

// Delete user
app.delete('/api/admin/users/:id', adminMiddleware, (req, res) => {
  db.run('DELETE FROM transactions WHERE user_id=?', [req.params.id]);
  db.run('DELETE FROM mobile_money WHERE user_id=?', [req.params.id]);
  db.run('DELETE FROM notifications WHERE user_id=?', [req.params.id]);
  db.run('DELETE FROM users WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Adjust balance
app.put('/api/admin/users/:id/balance', adminMiddleware, async (req, res) => {
  const { balance, note } = req.body;
  if (balance < 0) return res.status(400).json({ error: 'Balance cannot be negative' });
  db.get('SELECT balance,name,email FROM users WHERE id=?', [req.params.id], async (err, user) => {
    if (!user) return res.status(404).json({ error: 'Not found' });
    const diff = balance - user.balance;
    db.run('UPDATE users SET balance=? WHERE id=?', [balance, req.params.id]);
    if (diff !== 0) {
      db.run(`INSERT INTO transactions (id,user_id,name,type,amount,note,icon) VALUES (?,?,?,?,?,?,?)`,
        ['tx_'+Date.now(), req.params.id, 'Admin Adjustment', diff>0?'credit':'debit', Math.abs(diff), note||'Balance adjustment by admin', '⚙️']);
      await sendEmail(user.email, `Account Balance Updated — ${BANK_NAME}`, 'Balance Update',
        `<p>Hi ${user.name},</p>
        <div class="highlight"><strong>New Balance: $${parseFloat(balance).toFixed(2)}</strong><br/>
        <span style="color:#666; font-size:14px;">${note||'Balance adjusted by admin'}</span></div>`
      );
      addNotification(req.params.id, '💰 Balance Updated', `Your balance was updated to $${parseFloat(balance).toFixed(2)}`, 'info');
    }
    res.json({ success: true, newBalance: balance });
  });
});

// KYC review
app.put('/api/admin/kyc/:id', adminMiddleware, async (req, res) => {
  const { status, notes } = req.body; // 'approved' or 'rejected'
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.run(`UPDATE users SET kyc_status=?,kyc_reviewed_at=?,kyc_notes=? WHERE id=?`,
    [status, new Date().toISOString(), notes||'', req.params.id], async (err) => {
      if (err) return res.status(500).json({ error: err.message });

      db.get('SELECT name,email FROM users WHERE id=?', [req.params.id], async (err, user) => {
        if (user) {
          const approved = status === 'approved';
          await sendEmail(user.email, `KYC ${approved?'Approved':'Rejected'} — ${BANK_NAME}`,
            approved ? 'KYC Approved! ✅' : 'KYC Rejected ❌',
            `<p>Hi ${user.name},</p>
            ${approved
              ? `<p>Your KYC verification has been <strong style="color:#38A169;">approved</strong>! You now have full access to all features.</p>
                 <p><a href="${BANK_URL}/pages/dashboard.html" class="btn">Go to Dashboard →</a></p>`
              : `<p>Your KYC verification was <strong style="color:#E53E3E;">rejected</strong>.</p>
                 <div class="highlight"><strong>Reason:</strong> ${notes||'Document not valid'}</div>
                 <p>Please resubmit with a valid government-issued ID.</p>
                 <p><a href="${BANK_URL}/pages/kyc.html" class="btn">Resubmit KYC →</a></p>`
            }`
          );
          addNotification(req.params.id,
            approved ? '✅ KYC Approved' : '❌ KYC Rejected',
            approved ? 'Your account is fully verified!' : `KYC rejected: ${notes||'Please resubmit'}`,
            approved ? 'success' : 'warning'
          );
        }
      });
      res.json({ success: true });
    });
});

// Pending KYC list
app.get('/api/admin/kyc', adminMiddleware, (req, res) => {
  db.all(`SELECT id,name,email,phone,kyc_status,kyc_doc,kyc_doc_type,kyc_submitted_at FROM users
    WHERE kyc_status IN ('submitted','pending') ORDER BY kyc_submitted_at DESC`, [], (err, rows) => {
    res.json(rows || []);
  });
});

// All transactions
app.get('/api/admin/transactions', adminMiddleware, (req, res) => {
  db.all(`SELECT t.*, u.name as user_name FROM transactions t LEFT JOIN users u ON t.user_id=u.id ORDER BY t.date DESC`, [], (err, rows) => {
    res.json(rows || []);
  });
});

// Stats
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  db.get('SELECT COUNT(*) as total, SUM(balance) as totalBalance FROM users WHERE is_admin=0', [], (err, users) => {
    db.get('SELECT COUNT(*) as total FROM transactions', [], (err, txs) => {
      db.get('SELECT SUM(amount) as total FROM transactions WHERE type="credit"', [], (err, credits) => {
        db.get('SELECT SUM(amount) as total FROM transactions WHERE type="debit"', [], (err, debits) => {
          db.get(`SELECT COUNT(*) as total FROM users WHERE date(joined)=date('now') AND is_admin=0`, [], (err, today) => {
            db.get(`SELECT COUNT(*) as total FROM users WHERE kyc_status='submitted'`, [], (err, pendingKyc) => {
              res.json({
                totalUsers: users?.total||0, totalBalance: users?.totalBalance||0,
                totalTransactions: txs?.total||0, totalCredits: credits?.total||0,
                totalDebits: debits?.total||0, newToday: today?.total||0,
                pendingKyc: pendingKyc?.total||0
              });
            });
          });
        });
      });
    });
  });
});

// Clear transactions
app.delete('/api/admin/transactions', adminMiddleware, (req, res) => {
  db.run('DELETE FROM transactions', [], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Test email
app.post('/api/admin/test-email', adminMiddleware, async (req, res) => {
  const { to } = req.body;
  await sendEmail(to, `Test Email — ${BANK_NAME}`, 'Email System Working! ✅',
    `<p>This is a test email from your ${BANK_NAME} admin panel.</p>
    <div class="highlight"><strong>Email notifications are configured correctly!</strong></div>`
  );
  res.json({ success: true, message: EMAIL_USER ? 'Email sent!' : 'Email not configured (check EMAIL_USER and EMAIL_PASS env vars)' });
});

// ---- SERVE FRONTEND ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🏦 NexaBank v2.0 running on http://localhost:${PORT}`);
  console.log(`📧 Email: ${EMAIL_USER ? '✅ Configured' : '⚠️ Not configured (set EMAIL_USER + EMAIL_PASS)'}`);
  console.log(`📱 Mobile Money: ${MTN_SUBSCRIPTION_KEY ? '✅ Live' : '🧪 Sandbox mode'}`);
  console.log(`🔐 Admin setup: /pages/admin-setup.html\n`);
});

// ============================
// ---- LOAN ROUTES ----
// ============================

// Apply for loan
app.post('/api/loans/apply', authMiddleware, (req, res) => {
  const { amount, tenure, purpose, details, income } = req.body;
  if (!amount || !tenure || !purpose || !income) return res.status(400).json({ error: 'Missing fields' });
  if (amount < 50 || amount > 50000) return res.status(400).json({ error: 'Amount must be between $50 and $50,000' });

  db.get('SELECT * FROM users WHERE id=?', [req.user.id], (err, user) => {
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.kyc_status !== 'approved') return res.status(403).json({ error: 'KYC verification required' });

    db.get('SELECT id FROM loans WHERE user_id=? AND status IN ("pending","active","approved")', [req.user.id], (err, existing) => {
      if (existing) return res.status(409).json({ error: 'You already have an active or pending loan' });

      const rate = 0.05;
      const interest = amount * rate * tenure;
      const total = amount + interest;
      const monthly = total / tenure;

      const schedule = [];
      for (let i = 1; i <= tenure; i++) {
        const due = new Date();
        due.setMonth(due.getMonth() + i);
        schedule.push({ instalment: i, amount: monthly, due_date: due.toISOString(), paid: false, paid_at: null });
      }

      const id = 'loan_' + Date.now();
      db.run(`INSERT INTO loans (id,user_id,amount,tenure,purpose,details,income,interest_rate,interest,total_repayment,monthly_payment,schedule,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, req.user.id, amount, tenure, purpose, details||'', income, rate, interest, total, monthly, JSON.stringify(schedule), 'pending'],
        async (err) => {
          if (err) return res.status(500).json({ error: err.message });

          await sendEmail(user.email, `Loan Application Received — ${BANK_NAME}`, 'Loan Application Submitted ✅',
            `<p>Hi ${user.name},</p>
            <p>We have received your loan application.</p>
            <div class="highlight">
              <strong>Amount: $${parseFloat(amount).toFixed(2)}</strong><br/>
              <span style="color:#666; font-size:14px;">Purpose: ${purpose} • Tenure: ${tenure} months</span><br/>
              <span style="color:#666; font-size:14px;">Monthly Payment: $${monthly.toFixed(2)}</span>
            </div>
            <p>We will review your application within 24–48 hours and notify you by email.</p>`
          );
          addNotification(req.user.id, '📋 Loan Application Submitted', `Your $${amount} ${purpose} loan is under review.`, 'info');
          res.json({ success: true, loanId: id });
        });
    });
  });
});

// Get my loans
app.get('/api/loans', authMiddleware, (req, res) => {
  db.all('SELECT * FROM loans WHERE user_id=? ORDER BY applied_at DESC', [req.user.id], (err, rows) => {
    res.json((rows || []).map(r => ({ ...r, schedule: JSON.parse(r.schedule || '[]') })));
  });
});

// Make repayment
app.post('/api/loans/:id/pay', authMiddleware, (req, res) => {
  const { instalment } = req.body;
  db.get('SELECT * FROM loans WHERE id=? AND user_id=?', [req.params.id, req.user.id], (err, loan) => {
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const schedule = JSON.parse(loan.schedule || '[]');
    const idx = schedule.findIndex(s => s.instalment === instalment && !s.paid);
    if (idx < 0) return res.status(400).json({ error: 'Invalid instalment' });

    db.get('SELECT balance FROM users WHERE id=?', [req.user.id], async (err, user) => {
      if (user.balance < schedule[idx].amount) return res.status(400).json({ error: 'Insufficient funds' });

      schedule[idx].paid = true;
      schedule[idx].paid_at = new Date().toISOString();
      const amountPaid = (loan.amount_paid || 0) + schedule[idx].amount;
      const allPaid = schedule.every(s => s.paid);
      const newStatus = allPaid ? 'completed' : 'active';

      db.run('UPDATE loans SET schedule=?,amount_paid=?,status=? WHERE id=?', [JSON.stringify(schedule), amountPaid, newStatus, loan.id]);
      db.run('UPDATE users SET balance=balance-? WHERE id=?', [schedule[idx].amount, req.user.id]);
      db.run(`INSERT INTO transactions (id,user_id,name,type,amount,note,icon) VALUES (?,?,?,?,?,?,?)`,
        ['tx_'+Date.now(), req.user.id, 'Loan Repayment', 'debit', schedule[idx].amount, `Instalment #${instalment}`, '💳']);

      const dbUser = await new Promise(r => db.get('SELECT name,email FROM users WHERE id=?', [req.user.id], (e,u) => r(u)));
      await sendEmail(dbUser.email, `Loan Payment Received — ${BANK_NAME}`, 'Payment Received ✅',
        `<p>Hi ${dbUser.name},</p>
        <div class="highlight"><strong>Instalment #${instalment}: $${schedule[idx].amount.toFixed(2)} received</strong></div>
        ${allPaid ? '<p>🎉 Congratulations! Your loan is fully repaid.</p>' : `<p>Remaining: $${(loan.total_repayment - amountPaid).toFixed(2)}</p>`}`
      );
      addNotification(req.user.id, '💳 Payment Received', `Instalment #${instalment} of $${schedule[idx].amount.toFixed(2)} confirmed.`, 'success');

      db.get('SELECT balance FROM users WHERE id=?', [req.user.id], (e, u) => {
        res.json({ success: true, newBalance: u.balance, completed: allPaid });
      });
    });
  });
});

// Admin: get all loans
app.get('/api/admin/loans', adminMiddleware, (req, res) => {
  db.all(`SELECT l.*, u.name as user_name, u.email as user_email FROM loans l LEFT JOIN users u ON l.user_id=u.id ORDER BY l.applied_at DESC`, [], (err, rows) => {
    res.json((rows || []).map(r => ({ ...r, schedule: JSON.parse(r.schedule || '[]') })));
  });
});

// Admin: approve loan
app.put('/api/admin/loans/:id/approve', adminMiddleware, async (req, res) => {
  const { note } = req.body;
  db.get('SELECT * FROM loans WHERE id=?', [req.params.id], async (err, loan) => {
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    db.run('UPDATE loans SET status=?,approved_at=?,admin_note=? WHERE id=?', ['active', new Date().toISOString(), note||'', loan.id]);
    db.run('UPDATE users SET balance=balance+? WHERE id=?', [loan.amount, loan.user_id]);
    db.run(`INSERT INTO transactions (id,user_id,name,type,amount,note,icon) VALUES (?,?,?,?,?,?,?)`,
      ['tx_'+Date.now(), loan.user_id, 'Loan Disbursement', 'credit', loan.amount, `${loan.purpose} loan approved`, '💰']);

    const user = await new Promise(r => db.get('SELECT name,email FROM users WHERE id=?', [loan.user_id], (e,u) => r(u)));
    if (user) {
      await sendEmail(user.email, `Loan Approved — ${BANK_NAME}`, '🎉 Loan Approved!',
        `<p>Hi ${user.name},</p>
        <p>Your loan application has been approved!</p>
        <div class="highlight"><strong>$${parseFloat(loan.amount).toFixed(2)} has been credited to your account</strong><br/>
        <span style="color:#666; font-size:14px;">Monthly repayment: $${parseFloat(loan.monthly_payment).toFixed(2)}</span></div>
        <p><a href="${BANK_URL}/pages/loans.html" class="btn">View Repayment Schedule →</a></p>`
      );
      addNotification(loan.user_id, '✅ Loan Approved!', `$${loan.amount} has been credited to your account.`, 'success');
    }
    res.json({ success: true });
  });
});

// Admin: reject loan
app.put('/api/admin/loans/:id/reject', adminMiddleware, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  db.get('SELECT * FROM loans WHERE id=?', [req.params.id], async (err, loan) => {
    if (!loan) return res.status(404).json({ error: 'Not found' });
    db.run('UPDATE loans SET status=?,rejection_reason=? WHERE id=?', ['rejected', reason, loan.id]);
    const user = await new Promise(r => db.get('SELECT name,email FROM users WHERE id=?', [loan.user_id], (e,u) => r(u)));
    if (user) {
      await sendEmail(user.email, `Loan Application Update — ${BANK_NAME}`, 'Loan Application Rejected',
        `<p>Hi ${user.name},</p>
        <p>Unfortunately your loan application was not approved.</p>
        <div class="highlight"><strong>Reason:</strong> ${reason}</div>
        <p>You may apply again after 30 days or contact support for more information.</p>`
      );
      addNotification(loan.user_id, '❌ Loan Rejected', `Reason: ${reason}`, 'warning');
    }
    res.json({ success: true });
  });
});
