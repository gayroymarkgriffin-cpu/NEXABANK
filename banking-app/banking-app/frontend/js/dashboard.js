// ===== DASHBOARD JS =====

// --- DUMMY TRANSACTIONS ---
const DUMMY_TRANSACTIONS = [
  { id:'tx1', name:'Alice Johnson', type:'credit', amount:3250.00, note:'Freelance payment', date: new Date(Date.now()-1*86400000).toISOString(), icon:'💼' },
  { id:'tx2', name:'Netflix Subscription', type:'debit', amount:15.99, note:'Monthly plan', date: new Date(Date.now()-2*86400000).toISOString(), icon:'🎬' },
  { id:'tx3', name:'Salary - TechCorp', type:'credit', amount:4500.00, note:'Monthly salary', date: new Date(Date.now()-5*86400000).toISOString(), icon:'🏢' },
  { id:'tx4', name:'Rent Payment', type:'debit', amount:850.00, note:'Apartment rent', date: new Date(Date.now()-7*86400000).toISOString(), icon:'🏠' },
  { id:'tx5', name:'Jean Kamga', type:'credit', amount:120.00, note:'Lunch split', date: new Date(Date.now()-9*86400000).toISOString(), icon:'🍽️' },
  { id:'tx6', name:'Amazon Purchase', type:'debit', amount:67.49, note:'Electronics', date: new Date(Date.now()-10*86400000).toISOString(), icon:'📦' },
  { id:'tx7', name:'Electricity Bill', type:'debit', amount:45.00, note:'CamWater/ENEO', date: new Date(Date.now()-12*86400000).toISOString(), icon:'⚡' },
  { id:'tx8', name:'Upwork Payment', type:'credit', amount:780.00, note:'Web project', date: new Date(Date.now()-14*86400000).toISOString(), icon:'💻' },
  { id:'tx9', name:'Grocery Store', type:'debit', amount:134.20, note:'Weekly groceries', date: new Date(Date.now()-16*86400000).toISOString(), icon:'🛒' },
  { id:'tx10', name:'Spotify', type:'debit', amount:9.99, note:'Premium subscription', date: new Date(Date.now()-18*86400000).toISOString(), icon:'🎵' },
  { id:'tx11', name:'Maria Santos', type:'credit', amount:500.00, note:'Consulting fee', date: new Date(Date.now()-20*86400000).toISOString(), icon:'🤝' },
  { id:'tx12', name:'Internet Bill', type:'debit', amount:30.00, note:'Camtel fiber', date: new Date(Date.now()-22*86400000).toISOString(), icon:'🌐' },
];

// --- GET/INIT TRANSACTIONS ---
function getTransactions() {
  const stored = localStorage.getItem('nexabank_transactions');
  if (stored) return JSON.parse(stored);
  localStorage.setItem('nexabank_transactions', JSON.stringify(DUMMY_TRANSACTIONS));
  return DUMMY_TRANSACTIONS;
}

function addTransaction(tx) {
  const txs = getTransactions();
  txs.unshift(tx);
  localStorage.setItem('nexabank_transactions', JSON.stringify(txs));
}

// --- RENDER TRANSACTIONS ---
function renderTransactions(txList, containerId, limit) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const list = limit ? txList.slice(0, limit) : txList;

  if (list.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = list.map(tx => `
    <div class="tx-item">
      <div class="tx-icon ${tx.type}">${tx.icon || (tx.type==='credit'?'📥':'📤')}</div>
      <div class="tx-info">
        <div class="tx-name">${tx.name}</div>
        <div class="tx-date">${formatDate(tx.date)}${tx.note ? ' · ' + tx.note : ''}</div>
      </div>
      <div>
        <div class="tx-amount ${tx.type}">${tx.type==='credit' ? '+' : '-'}$${tx.amount.toFixed(2)}</div>
        <span class="tx-badge ${tx.type}" style="float:right; margin-top:4px;">${tx.type==='credit' ? 'Income' : 'Expense'}</span>
      </div>
    </div>
  `).join('');
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return diff + ' days ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// --- AUTH GUARD ---
function getSession() {
  const session = localStorage.getItem('nexabank_session');
  if (!session) { window.location.href = 'login.html'; return null; }
  return JSON.parse(session);
}

function logout() {
  localStorage.removeItem('nexabank_session');
  window.location.href = 'login.html';
}

// --- GREETING ---
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// --- SIDEBAR TOGGLE ---
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// --- MODALS ---
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open');
  });
});

// --- SEND MONEY ---
function sendMoney() {
  const to = document.getElementById('sendTo')?.value.trim();
  const amount = parseFloat(document.getElementById('sendAmount')?.value);
  const note = document.getElementById('sendNote')?.value.trim();
  const errEl = document.getElementById('sendError');
  errEl.style.display = 'none';

  if (!to) { errEl.textContent = 'Please enter a recipient'; errEl.style.display = 'block'; return; }
  if (!amount || amount <= 0) { errEl.textContent = 'Please enter a valid amount'; errEl.style.display = 'block'; return; }

  const user = JSON.parse(localStorage.getItem('nexabank_session') || '{}');
  const balance = user.balance || 5000;

  if (amount > balance) { errEl.textContent = 'Insufficient funds'; errEl.style.display = 'block'; return; }

  const btn = document.querySelector('#sendModal .btn-gold');
  btn.textContent = 'Processing...';
  btn.disabled = true;

  setTimeout(() => {
    user.balance = parseFloat((balance - amount).toFixed(2));
    localStorage.setItem('nexabank_session', JSON.stringify(user));

    addTransaction({
      id: 'tx_' + Date.now(),
      name: to,
      type: 'debit',
      amount,
      note: note || 'Transfer',
      date: new Date().toISOString(),
      icon: '📤'
    });

    closeModal('sendModal');
    btn.textContent = 'Send Money →';
    btn.disabled = false;
    document.getElementById('sendTo').value = '';
    document.getElementById('sendAmount').value = '';
    document.getElementById('sendNote').value = '';

    updateBalanceDisplay(user.balance);
    renderTransactions(getTransactions(), 'transactionsList', 6);

    showToast('✅ $' + amount.toFixed(2) + ' sent to ' + to);
  }, 1200);
}

// --- COPY ACCOUNT ---
function copyAccount() {
  const acc = document.getElementById('accountNumber')?.textContent;
  if (acc) navigator.clipboard.writeText(acc).then(() => showToast('Account number copied!'));
}

// --- TOAST NOTIFICATION ---
function showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    background:#1a2f54; border:1px solid rgba(212,175,55,0.3);
    color:white; padding:14px 20px; border-radius:10px;
    font-size:14px; font-weight:500;
    box-shadow:0 8px 32px rgba(0,0,0,0.4);
    animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// --- FORMAT CURRENCY ---
function formatCurrency(amount) {
  return '$' + parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- UPDATE BALANCE ---
function updateBalanceDisplay(balance) {
  const formatted = formatCurrency(balance);
  const el = document.getElementById('totalBalance');
  if (el) el.textContent = formatted;
  const side = document.getElementById('sidebarBalance');
  if (side) side.textContent = formatted;
}

// --- INIT DASHBOARD ---
window.addEventListener('load', () => {
  setTimeout(() => {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');
  }, 500);

  const user = getSession();
  if (!user) return;

  // Set greeting
  const welcomeMsg = document.getElementById('welcomeMsg');
  if (welcomeMsg) welcomeMsg.textContent = getGreeting() + ', ' + (user.name?.split(' ')[0] || 'there') + ' 👋';

  const welcomeDate = document.getElementById('welcomeDate');
  if (welcomeDate) welcomeDate.textContent = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  // Set avatar
  const initials = (user.name || 'JD').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  document.querySelectorAll('#userAvatar').forEach(el => el.textContent = initials);

  // Balance
  const balance = user.balance ?? 5000;
  updateBalanceDisplay(balance);

  // Account number in receive modal
  const accNumEl = document.getElementById('accountNumber');
  if (accNumEl) accNumEl.textContent = 'NEXA-' + (user.id || 'DEMO01').slice(-6).toUpperCase();

  // Transactions
  const txList = getTransactions();
  const isTransactionPage = window.location.pathname.includes('transactions');
  if (!isTransactionPage) {
    renderTransactions(txList, 'transactionsList', 6);
  }
});
