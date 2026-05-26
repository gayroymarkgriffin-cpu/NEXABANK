# 🏦 NexaBank — Full Stack Banking Website

A premium, fully responsive banking web app built with HTML/CSS/JS (frontend) and Node.js + Express + SQLite (backend).

---

## ✨ Features
- Beautiful dark navy + gold UI design
- Landing page with hero, features, testimonials
- Login & Register with form validation
- Dashboard with balance cards, quick actions
- Send money with real-time balance update
- Transaction history with filters & CSV export
- Profile & Settings page with password change
- Mobile responsive with sidebar navigation
- SQLite database (zero config, file-based)

---

## 🚀 Quick Start (Local)

### 1. Install dependencies
```bash
npm install
```

### 2. Run the server
```bash
npm start
```

### 3. Open in browser
```
http://localhost:3000
```

### 4. Demo login
```
Email:    demo@nexabank.com
Password: demo1234
```

> **Note:** The frontend also works without the backend! Just open `frontend/index.html` directly in your browser. It uses localStorage for data.

---

## 📁 Project Structure
```
/banking-app
  /frontend
    index.html          ← Landing page
    /pages
      login.html        ← Login page
      register.html     ← Register page
      dashboard.html    ← Main dashboard
      transactions.html ← Transaction history
      profile.html      ← Profile & settings
    /css
      style.css         ← Global styles
      landing.css       ← Landing page styles
      auth.css          ← Auth page styles
      dashboard.css     ← Dashboard styles
    /js
      main.js           ← Landing page JS
      auth.js           ← Auth helpers
      dashboard.js      ← Dashboard logic & data
  /backend
    server.js           ← Express server + API routes
  /database
    nexabank.db         ← SQLite database (auto-created)
  package.json
  README.md
```

---

## ☁️ Deploy for Free on Render

1. Push project to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Click **Deploy** — done in ~2 minutes!

---

## ☁️ Deploy on Railway

1. Go to [railway.app](https://railway.app)
2. New Project → Deploy from GitHub
3. Select your repo
4. Railway auto-detects Node.js and deploys!

---

## 🔐 Environment Variables (for production)
```
JWT_SECRET=your_very_long_random_secret_here
PORT=3000
```

---

## 🎨 Design Tokens
| Color | Hex |
|-------|-----|
| Navy (bg) | `#0A1628` |
| Navy Light | `#0F2040` |
| Gold (accent) | `#D4AF37` |
| White | `#FFFFFF` |
| Gray | `#A0AEC0` |

---

## 📬 API Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Login |
| GET | `/api/me` | Get current user |
| PUT | `/api/me` | Update profile |
| GET | `/api/transactions` | Get transactions |
| POST | `/api/send` | Send money |

---

Built with ❤️ by NexaBank Team
