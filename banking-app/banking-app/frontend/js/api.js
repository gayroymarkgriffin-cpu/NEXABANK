// ===== NEXABANK API HELPER =====
// This file connects every page to the real backend server
// All data goes to/from your Render database — not localStorage

const API = (() => {
  // Auto-detect the base URL (works locally and on Render)
  const BASE = window.location.origin;

  // ---- GET AUTH TOKEN ----
  function getToken() {
    return localStorage.getItem('nexabank_token') || '';
  }

  // ---- SAVE SESSION ----
  function saveSession(token, user) {
    localStorage.setItem('nexabank_token', token);
    localStorage.setItem('nexabank_session', JSON.stringify(user));
  }

  // ---- CLEAR SESSION ----
  function clearSession() {
    localStorage.removeItem('nexabank_token');
    localStorage.removeItem('nexabank_session');
  }

  // ---- GET SESSION ----
  function getSession() {
    const s = localStorage.getItem('nexabank_session');
    return s ? JSON.parse(s) : null;
  }

  // ---- BASE FETCH ----
  async function request(method, path, body = null, auth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers['Authorization'] = `Bearer ${getToken()}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(BASE + path, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ---- AUTH ----
  async function register(name, email, phone, password) {
    return request('POST', '/api/register', { name, email, phone, password }, false);
  }

  async function login(email, password) {
    return request('POST', '/api/login', { email, password }, false);
  }

  async function getMe() {
    return request('GET', '/api/me');
  }

  async function updateMe(name, phone) {
    return request('PUT', '/api/me', { name, phone });
  }

  async function changePassword(currentPassword, newPassword) {
    return request('PUT', '/api/me/password', { currentPassword, newPassword });
  }

  // ---- TRANSACTIONS ----
  async function getTransactions() {
    return request('GET', '/api/transactions');
  }

  async function sendMoney(to, amount, note) {
    return request('POST', '/api/send', { to, amount, note });
  }

  // ---- NOTIFICATIONS ----
  async function getNotifications() {
    return request('GET', '/api/notifications');
  }

  async function markNotificationsRead() {
    return request('PUT', '/api/notifications/read');
  }

  // ---- KYC ----
  async function submitKYC(formData) {
    const token = getToken();
    try {
      const res = await fetch(BASE + '/api/kyc/submit', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'KYC submission failed');
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function getKYCStatus() {
    return request('GET', '/api/kyc/status');
  }

  // ---- MOBILE MONEY ----
  async function mmDeposit(phone, amount, provider) {
    return request('POST', '/api/mobilemoney/deposit', { phone, amount, provider });
  }

  async function mmWithdraw(phone, amount, provider) {
    return request('POST', '/api/mobilemoney/withdraw', { phone, amount, provider });
  }

  async function mmHistory() {
    return request('GET', '/api/mobilemoney/history');
  }

  // ---- LOANS ----
  async function applyLoan(amount, tenure, purpose, details, income) {
    return request('POST', '/api/loans/apply', { amount, tenure, purpose, details, income });
  }

  async function getLoans() {
    return request('GET', '/api/loans');
  }

  async function payLoan(loanId, instalment) {
    return request('POST', `/api/loans/${loanId}/pay`, { instalment });
  }

  // ---- ADMIN ----
  async function adminStats() {
    return request('GET', '/api/admin/stats');
  }

  async function adminUsers() {
    return request('GET', '/api/admin/users');
  }

  async function adminUser(id) {
    return request('GET', `/api/admin/users/${id}`);
  }

  async function adminBlockUser(id, block) {
    return request('PUT', `/api/admin/users/${id}/block`, { block });
  }

  async function adminDeleteUser(id) {
    return request('DELETE', `/api/admin/users/${id}`);
  }

  async function adminAdjustBalance(id, balance, note) {
    return request('PUT', `/api/admin/users/${id}/balance`, { balance, note });
  }

  async function adminTransactions() {
    return request('GET', '/api/admin/transactions');
  }

  async function adminKYCList() {
    return request('GET', '/api/admin/kyc');
  }

  async function adminReviewKYC(id, status, notes) {
    return request('PUT', `/api/admin/kyc/${id}`, { status, notes });
  }

  async function adminLoans() {
    return request('GET', '/api/admin/loans');
  }

  async function adminApproveLoan(id, note) {
    return request('PUT', `/api/admin/loans/${id}/approve`, { note });
  }

  async function adminRejectLoan(id, reason) {
    return request('PUT', `/api/admin/loans/${id}/reject`, { reason });
  }

  async function adminTestEmail(to) {
    return request('POST', '/api/admin/test-email', { to });
  }

  async function adminSetup(name, email, password, setupKey) {
    return request('POST', '/api/admin/setup', { name, email, password, setupKey }, false);
  }

  // ---- UTILITY ----
  function formatCurrency(amount) {
    return '$' + parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return diff + ' days ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.textContent = msg;
    const colors = { success: '#1a2f54', error: '#2d1a1a', warning: '#2d2a1a' };
    const borders = { success: 'rgba(212,175,55,0.3)', error: 'rgba(229,62,62,0.3)', warning: 'rgba(214,158,46,0.3)' };
    toast.style.cssText = `
      position:fixed; bottom:24px; right:24px; z-index:9999;
      background:${colors[type]||colors.success};
      border:1px solid ${borders[type]||borders.success};
      color:white; padding:14px 20px; border-radius:10px;
      font-size:14px; font-weight:500;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);
      animation:slideIn 0.3s ease;
      max-width:320px;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function requireAuth() {
    const session = getSession();
    if (!session || !getToken()) {
      window.location.href = 'login.html';
      return null;
    }
    return session;
  }

  function requireAdmin() {
    const session = getSession();
    if (!session || !getToken()) { window.location.href = 'login.html'; return null; }
    if (!session.is_admin) { window.location.href = 'dashboard.html'; return null; }
    return session;
  }

  function logout() {
    clearSession();
    window.location.href = 'login.html';
  }

  return {
    getToken, saveSession, clearSession, getSession,
    register, login, getMe, updateMe, changePassword,
    getTransactions, sendMoney,
    getNotifications, markNotificationsRead,
    submitKYC, getKYCStatus,
    mmDeposit, mmWithdraw, mmHistory,
    applyLoan, getLoans, payLoan,
    adminStats, adminUsers, adminUser, adminBlockUser, adminDeleteUser,
    adminAdjustBalance, adminTransactions, adminKYCList, adminReviewKYC,
    adminLoans, adminApproveLoan, adminRejectLoan, adminTestEmail, adminSetup,
    formatCurrency, formatDate, showToast, requireAuth, requireAdmin, logout
  };
})();
