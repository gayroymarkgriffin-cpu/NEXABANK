const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexabank_secret_key_change_in_production';
const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'NEXAADMIN2025';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const dbDir = path.join(__dirname, '../database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new sqlite3.Database(path.join(dbDir, 'nexabank.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    phone TEXT, password TEXT NOT NULL, balance REAL DEFAULT 5000.00,
    is_admin INTEGER DEFAULT 0, is_blocked INTEGER DEFAULT 0,
    joined TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    type TEXT NOT NULL, amount REAL NOT NULL, note TEXT,
    icon TEXT DEFAULT '💳', date TEXT DEFAULT (datetime('now'))
  )`);

  db.get('SELECT id FROM users WHERE email = ?', ['demo@nexabank.com'], (err, row) => {
    if (!row) {
      const hashed = bcrypt.hashSync('demo1234', 10);
      db.run(`INSERT INTO users (id,name,email,phone,password,balance) VALUES (?,?,?,?,?,?)`,
        ['demo_001','John Doe','demo@nexabank.com','+237 600 000 000',hashed,12450.00]);
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

// REGISTER
app.post('/api/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password too short' });
  db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
    if (row) return res.status(409).json({ error: 'Email already registered' });
    const id = 'usr_' + Date.now();
    const hashed = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO users (id,name,email,phone,password) VALUES (?,?,?,?,?)`, [id,name,email,phone||'',hashed], (err) => {
      if (err) return res.status(500).json({ error: 'Registration failed' });
      const token = jwt.sign({ id, email, name, is_admin: false }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user: { id, name, email, balance: 5000.00 } });
    });
  });
});

// LOGIN
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_blocked) return res.status(403).json({ error: 'Account blocked. Contact support.' });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, is_admin: !!user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, balance: user.balance, is_admin: !!user.is_admin } });
  });
});

// ME
app.get('/api/me', authMiddleware, (req, res) => {
  db.get('SELECT id,name,email,phone,balance,joined,is_admin FROM users WHERE id = ?', [req.user.id], (err, user) => {
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
app.post('/api/send', authMiddleware, (req, res) => {
  const { to, amount, note } = req.body;
  if (!to || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid request' });
  db.get('SELECT balance FROM users WHERE id=?', [req.user.id], (err, user) => {
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient funds' });
    db.run('UPDATE users SET balance=balance-? WHERE id=?', [amount, req.user.id]);
    db.run(`INSERT INTO transactions (id,user_id,name,type,amount,note,icon) VALUES (?,?,?,?,?,?,?)`,
      ['tx_'+Date.now(), req.user.id, to, 'debit', amount, note||'Transfer', '📤']);
    db.get('SELECT balance FROM users WHERE id=?', [req.user.id], (err, u) => {
      res.json({ success: true, newBalance: u.balance });
    });
  });
});

// ====== ADMIN ROUTES ======

// One-time admin setup
app.post('/api/admin/setup', (req, res) => {
  const { name, email, password, setupKey } = req.body;
  if (setupKey !== ADMIN_SETUP_KEY) return res.status(403).json({ error: 'Invalid setup key' });
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Invalid data' });
  db.get('SELECT id FROM users WHERE is_admin=1', [], (err, existing) => {
    if (existing) return res.status(409).json({ error: 'Admin already exists' });
    const id = 'admin_' + Date.now();
    const hashed = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO users (id,name,email,phone,password,balance,is_admin) VALUES (?,?,?,?,?,?,?)`,
      [id,name,email,'',hashed,0,1], (err) => {
        if (err) return res.status(500).json({ error: 'Setup failed: '+err.message });
        res.json({ success: true, message: 'Admin created!' });
      });
  });
});

// All users
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  db.all('SELECT id,name,email,phone,balance,is_admin,is_blocked,joined FROM users ORDER BY joined DESC', [], (err, rows) => {
    res.json(rows || []);
  });
});

// Single user
app.get('/api/admin/users/:id', adminMiddleware, (req, res) => {
  db.get('SELECT id,name,email,phone,balance,is_admin,is_blocked,joined FROM users WHERE id=?', [req.params.id], (err, user) => {
    if (!user) return res.status(404).json({ error: 'Not found' });
    db.all('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC', [req.params.id], (err, txs) => {
      res.json({ ...user, transactions: txs || [] });
    });
  });
});

// Block/unblock
app.put('/api/admin/users/:id/block', adminMiddleware, (req, res) => {
  const { block } = req.body;
  db.run('UPDATE users SET is_blocked=? WHERE id=?', [block?1:0, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Delete user
app.delete('/api/admin/users/:id', adminMiddleware, (req, res) => {
  db.run('DELETE FROM transactions WHERE user_id=?', [req.params.id]);
  db.run('DELETE FROM users WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Adjust balance
app.put('/api/admin/users/:id/balance', adminMiddleware, (req, res) => {
  const { balance } = req.body;
  if (balance < 0) return res.status(400).json({ error: 'Balance cannot be negative' });
  db.run('UPDATE users SET balance=? WHERE id=?', [balance, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, newBalance: balance });
  });
});

// All transactions (admin)
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
            res.json({
              totalUsers: users?.total||0, totalBalance: users?.totalBalance||0,
              totalTransactions: txs?.total||0, totalCredits: credits?.total||0,
              totalDebits: debits?.total||0, newToday: today?.total||0
            });
          });
        });
      });
    });
  });
});

// Clear all transactions
app.delete('/api/admin/transactions', adminMiddleware, (req, res) => {
  db.run('DELETE FROM transactions', [], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🏦 NexaBank running on http://localhost:${PORT}`);
  console.log(`📧 Demo: demo@nexabank.com / demo1234`);
  console.log(`🔐 Admin setup: /pages/admin-setup.html\n`);
});
