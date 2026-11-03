# PaySmart AI: AI-Powered Smart Payment & Financial Management Platform

> **Official Project Submission for the PayPal AI Hackathon 2026**  
> *Transforming PayPal payment operations into automated, real-time financial intelligence powered by Google Gemini and SQLite.*

---

## 1. Problem Statement & Target Users

### Problem
Modern payment applications process millions of transactions, yet payment gateways historically remain **disconnected from intelligent budgeting and proactive financial guidance**:
- Users must manually categorize receipts, copy totals into disparate spreadsheets, or guess their end-of-month cashflow velocity.
- Generic AI chatbots suffer from severe hallucination because they lack authenticated access to real ledger facts and payment receipts.
- Small businesses and freelancers struggle to reconcile PayPal transactions with recurring overhead, tax-deductible items, and savings targets.

### Target Users
- **Freelancers & Independent Contractors**: Manage incoming client payments, track business expenses, and plan taxes.
- **Small Business Owners & E-Commerce Merchants**: Monitor digital receipts, centralize PayPal payments, and evaluate operational cashflow.
- **Everyday Consumers & Digital Natives**: Track recurring subscriptions, balance 50/30/20 budgets, and make data-grounded spending decisions.

---

## 2. PayPal Sandbox Integration

PaySmart AI implements server-authoritative integration with the official **PayPal Developer REST API v2**:
1. **Order Creation (`POST /v2/checkout/orders`)**:
   - Initiates sandbox payment orders with merchant brand, currency, amount, and reference IDs.
2. **Sandbox Authorization & Approval**:
   - Directs the payer to PayPal Sandbox checkout or uses the interactive PaySmart Sandbox test engine.
3. **Payment Capture (`POST /v2/checkout/orders/{id}/capture`)**:
   - Authorizes server-side capture, verifies payment status, and guards against duplicate capture attempts.
4. **Persistent Auditing & Receipt Generation**:
   - Captured orders are permanently logged in the SQLite `payments` and `transactions` tables with payment method badges and digital receipts.

---

## 3. Google Gemini AI Integration

PaySmart AI connects **Google Gemini Flash** directly to the user's authenticated SQLite financial database:
- **Verified Fact Prompting**: Every AI request loads the user's authentic income, expenses, savings rate, category breakdown, and financial health score directly from SQLite.
- **Strict Anti-Hallucination**: The prompt instructs: *"Use ONLY these numbers, never recalculate or invent figures."*
- **Reliable Fallback Architecture**: Primary Flash model with exponential backoff retry (1s, 2s, 4s), fast failover on quota exhaustion to secondary Flash-Lite models, and an enforced 25-second attempt timeout.
- **10-Minute Response Caching**: Answers are cached in-memory for 10 minutes keyed by the user's question and a SHA-256 cryptographic hash of their ledger data, avoiding redundant API calls.
- **Diagnostic Health Endpoint**: `GET /api/ai/health` provides real-time verification of the active Gemini model.

---

## 4. Main Features

- 💳 **PayPal Sandbox Hub**: Create, approve, and capture payments with instant ledger synchronization and receipt modals.
- 🤖 **Context-Grounded AI Advisor**: Real-time financial consultation with interactive markdown formatting (via `react-markdown` and `remark-gfm`).
- 📊 **Unified Financial Health Score**: Synchronized 0-100 health score (`calcHealthScore`) identical across dashboard, sidebar, and AI prompts.
- 📈 **FinTech Analytics & 50/30/20 Framework**: Interactive Recharts graphs showing income vs. expense curves, category donuts, and savings ratios.
- 📝 **Full-Featured Ledger**: Search, filter, categorize, add, edit, delete, and CSV export.

---

## 5. Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React, Recharts, React-Markdown, Remark-GFM |
| **Backend** | Node.js, Express, tsx, Better-SQLite3, JsonWebToken, Bcrypt.js |
| **Payment Gateway** | Official PayPal Developer REST API v2, Sandbox Mode |
| **AI Model** | Google Gemini Flash & Flash-Lite via `@google/genai` TypeScript SDK |
| **Database** | SQLite3 with Write-Ahead Logging (WAL mode) |

---

## 6. Environment Variables

Configure the following variables in `.env` (refer to `.env.example`):

| Variable Name | Description |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key (injected automatically in AI Studio) |
| `APP_URL` | Public or local base URL (e.g. `http://localhost:3000`) |
| `PAYPAL_CLIENT_ID` | PayPal Developer Sandbox Client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal Developer Sandbox Secret |
| `PAYPAL_MODE` | PayPal mode (`sandbox` or `live`) |
| `JWT_SECRET` | Secret key for JWT session tokens |

---

## 7. Setup & Running

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests
npm test

# 3. Start development server (Port 3000)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Evaluator Demo Credentials:
- **Email**: `demo@paysmart.ai`
- **Password**: `Demo1234!`
- Pre-seeded with 15 realistic transactions across 8 spending categories.

---

## 8. License

This project is licensed under the [MIT License](LICENSE).
