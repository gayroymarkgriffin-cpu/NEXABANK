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

// MIDDLEWARE
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// DATABASE SETUP
const dbDir = path.join(__dirname, '../database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(path.join(dbDir, 'nexabank.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT NOT NULL,
    balance REAL DEFAULT 5000.00,
    joined TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    icon TEXT DEFAULT '💳',
    date TEXT DEFAULT (datetime('now'))
  )`);

  // Seed demo user
  db.get('SELECT id FROM users WHERE email = ?', ['demo@nexabank.com'], (err, row) => {
    if (!row) {
      const hashed = bcrypt.hashSync('demo1234', 10);
      db.run(`INSERT INTO users (id, name, email, phone, password, balance) VALUES (?,?,?,?,?,?)`,
        ['demo_001', 'John Doe', 'demo@nexabank.com', '+237 600 000 000', hashed, 12450.00]);

      const txs = [
        ['tx1', 'demo_001', 'Alice Johnson', 'credit', 3250.00, 'Freelance payment', '💼'],
        ['tx2', 'demo_001', 'Netflix', 'debit', 15.99, 'Monthly plan', '🎬'],
        ['tx3', 'demo_001', 'Salary - TechCorp', 'credit', 4500.00, 'Monthly salary', '🏢'],
        ['tx4', 'demo_001', 'Rent Payment', 'debit', 850.00, 'Apartment rent', '🏠'],
        ['tx5', 'demo_001', 'Jean Kamga', 'credit', 120.00, 'Lunch split', '🍽️'],
        ['tx6', 'demo_001', 'Amazon', 'debit', 67.49, 'Electronics', '📦'],
      ];

      txs.forEach(tx => {
        db.run(`INSERT INTO transactions (id, user_id, name, type, amount, note, icon) VALUES (?,?,?,?,?,?,?)`, tx);
      });
      console.log('✅ Demo user seeded');
    }
  });
});

// AUTH MIDDLEWARE
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

// ROUTES

// Register
app.post('/api/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password too short' });

  db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
    if (row) return res.status(409).json({ error: 'Email already registered' });

    const id = 'usr_' + Date.now();
    const hashed = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO users (id, name, email, phone, password) VALUES (?,?,?,?,?)`,
      [id, name, email, phone || '', hashed], (err) => {
        if (err) return res.status(500).json({ error: 'Registration failed' });
        const token = jwt.sign({ id, email, name }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id, name, email, balance: 5000.00 } });
      });
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, balance: user.balance } });
  });
});

// Get current user
app.get('/api/me', authMiddleware, (req, res) => {
  db.get('SELECT id, name, email, phone, balance, joined FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  });
});

// Update profile
app.put('/api/me', authMiddleware, (req, res) => {
  const { name, phone } = req.body;
  db.run('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone, req.user.id]);
  res.json({ success: true });
});

// Get transactions
app.get('/api/transactions', authMiddleware, (req, res) => {
  db.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [req.user.id], (err, rows) => {
    res.json(rows || []);
  });
});

// Send money
app.post('/api/send', authMiddleware, (req, res) => {
  const { to, amount, note } = req.body;
  if (!to || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid request' });

  db.get('SELECT balance FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient funds' });

    db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, req.user.id]);

    const txId = 'tx_' + Date.now();
    db.run(`INSERT INTO transactions (id, user_id, name, type, amount, note, icon) VALUES (?,?,?,?,?,?,?)`,
      [txId, req.user.id, to, 'debit', amount, note || 'Transfer', '📤']);

    db.get('SELECT balance FROM users WHERE id = ?', [req.user.id], (err, updated) => {
      res.json({ success: true, newBalance: updated.balance });
    });
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`🏦 NexaBank running on http://localhost:${PORT}`);
  console.log(`📧 Demo: demo@nexabank.com / demo1234`);
});
