// ===== NEXABANK BACKEND (Node.js + Express + SQLite) =====
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexabank_secret_key_change_in_production';

// ---- MIDDLEWARE ----
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ---- DATABASE SETUP ----
const db = new Database(path.join(__dirname, '../database/nexabank.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT NOT NULL,
    balance REAL DEFAULT 5000.00,
    joined TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('credit','debit')),
    amount REAL NOT NULL,
    note TEXT,
    icon TEXT DEFAULT '💳',
    date TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// ---- SEED DEMO USER ----
const demoExists = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@nexabank.com');
if (!demoExists) {
  const hashedPass = bcrypt.hashSync('demo1234', 10);
  db.prepare(`INSERT INTO users (id, name, email, phone, password, balance) VALUES (?,?,?,?,?,?)`)
    .run('demo_001', 'John Doe', 'demo@nexabank.com', '+237 600 000 000', hashedPass, 12450.00);

  const seedTx = [
    { id:'tx1', name:'Alice Johnson', type:'credit', amount:3250.00, note:'Freelance payment', icon:'💼' },
    { id:'tx2', name:'Netflix', type:'debit', amount:15.99, note:'Monthly plan', icon:'🎬' },
    { id:'tx3', name:'Salary - TechCorp', type:'credit', amount:4500.00, note:'Monthly salary', icon:'🏢' },
    { id:'tx4', name:'Rent Payment', type:'debit', amount:850.00, note:'Apartment rent', icon:'🏠' },
    { id:'tx5', name:'Jean Kamga', type:'credit', amount:120.00, note:'Lunch split', icon:'🍽️' },
    { id:'tx6', name:'Amazon', type:'debit', amount:67.49, note:'Electronics', icon:'📦' },
  ];

  const insertTx = db.prepare(`INSERT INTO transactions (id, user_id, name, type, amount, note, icon) VALUES (?,?,?,?,?,?,?)`);
  seedTx.forEach(tx => insertTx.run(tx.id, 'demo_001', tx.name, tx.type, tx.amount, tx.note, tx.icon));
  console.log('✅ Demo user seeded');
}

// ---- AUTH MIDDLEWARE ----
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ---- ROUTES ----

// Register
app.post('/api/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password too short' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const id = 'usr_' + Date.now();
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare(`INSERT INTO users (id, name, email, phone, password) VALUES (?,?,?,?,?)`)
    .run(id, name, email, phone || '', hashed);

  const token = jwt.sign({ id, email, name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id, name, email, balance: 5000.00 } });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, balance: user.balance } });
});

// Get current user
app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, name, email, phone, balance, joined FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Update profile
app.put('/api/me', authMiddleware, (req, res) => {
  const { name, phone } = req.body;
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);
  res.json({ success: true });
});

// Get transactions
app.get('/api/transactions', authMiddleware, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC').all(req.user.id);
  res.json(txs);
});

// Send money
app.post('/api/send', authMiddleware, (req, res) => {
  const { to, amount, note } = req.body;
  if (!to || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid request' });

  const sender = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
  if (sender.balance < amount) return res.status(400).json({ error: 'Insufficient funds' });

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, req.user.id);

  const txId = 'tx_' + Date.now();
  db.prepare(`INSERT INTO transactions (id, user_id, name, type, amount, note, icon) VALUES (?,?,?,?,?,?,?)`)
    .run(txId, req.user.id, to, 'debit', amount, note || 'Transfer', '📤');

  const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id).balance;
  res.json({ success: true, newBalance, txId });
});

// ---- SERVE FRONTEND ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🏦 NexaBank server running on http://localhost:${PORT}`);
  console.log(`📧 Demo login: demo@nexabank.com / demo1234\n`);
});
