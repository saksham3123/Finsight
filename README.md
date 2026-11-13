# FinSight

A web platform for tracking a portfolio of Indian stocks and cryptocurrencies, with machine-learning
forecasts that are tested honestly before they are shown. University major project.

> Research prototype, not financial advice.

## What it does

- **Portfolio:** watchlist, buy/sell transactions, holdings with profit and loss, and SIP plans.
- **Markets:** daily prices and charts for 10 NSE large caps and 5 cryptocurrencies.
- **Forecasts:** an 80% price range for the close in 5 trading days, plus a direction signal labelled "no proven edge".
- **Assistant:** a chat assistant that answers only from the user's own data and the latest advisories.

## Parts

| Folder | What it is | Details |
|---|---|---|
| `frontend/` | React 19 single-page app (Vite, Tailwind CSS 4, Recharts) | `frontend/.env.example` |
| `backend/` | REST API (Node.js, Express 5, PostgreSQL) | `backend/README.md` |
| `ml/` | Python pipeline: data, models, walk-forward evaluation, publishing | `ml/README.md`, `ml/reports/EVALUATION.md` |

## Run it locally (PowerShell)

Needs Node.js 24, PostgreSQL 15 or later, and Python 3 for the ML pipeline.

```powershell
# 1. Backend: http://localhost:5000/api
cd backend
npm install
copy .env.example .env      # fill in DATABASE_URL, JWT_SECRET, ML_SERVICE_KEY, ADMIN_PASSWORD
npm run migrate
npm run seed
npm run dev

# 2. Frontend: http://localhost:5173
cd frontend
npm install
npm run dev

# 3. ML pipeline: real prices and forecasts into the backend
cd ml
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
copy .env.example .env      # ML_SERVICE_KEY must match backend/.env
.venv\Scripts\python -m finsight_ml all --publish
```

A full `all` run re-evaluates every model and takes a few hours on a CPU. To refresh only the
forecasts, run `fetch`, `train`, `predict` and `publish` instead.

## Main findings

- **Direction is not predictable from past prices.** Seven models from four families scored AUC of about 0.50 on both markets in walk-forward testing.
- **The size of moves is.** The 80% range forecasts beat a constant range by 6.2% on stocks and 3.1% on crypto, with 95% intervals that exclude zero, and the result held on a two-year hold-out.

## Tests

```powershell
cd backend; npm test                              # API tests against a separate test database
cd ml; .venv\Scripts\python -m unittest -v      # ML unit tests
```
