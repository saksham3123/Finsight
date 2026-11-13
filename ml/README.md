# FinSight ML

Predicts whether each asset's price will be **higher in 5 trading days**, evaluates that honestly with walk-forward testing, and publishes buy/hold/sell/watch/high-risk advisories to the FinSight backend.

> Research prototype. Short-term price direction is very hard to predict, and the evaluation report says plainly when a model has no reliable edge. Not financial advice.

## Setup (PowerShell)

```powershell
cd ml
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
copy .env.example .env    # ML_SERVICE_KEY must match backend/.env
```

## Usage

```powershell
.venv\Scripts\python -m finsight_ml fetch              # download prices (stocks: Yahoo Finance, crypto: Binance)
.venv\Scripts\python -m finsight_ml evaluate           # walk-forward test of all models → reports/EVALUATION.md
.venv\Scripts\python -m finsight_ml range-evaluate     # walk-forward test of the 80% range models → reports/range_*.json
.venv\Scripts\python -m finsight_ml train              # fit the selected direction and range models per asset type → models/
.venv\Scripts\python -m finsight_ml predict            # score today → reports/predictions.json
.venv\Scripts\python -m finsight_ml publish            # push real prices + advisories to the backend (npm run dev)
.venv\Scripts\python -m finsight_ml all --publish      # everything, e.g. as a daily scheduled task
.venv\Scripts\python -m unittest -v                    # unit tests
```

Add `--type stock` or `--type crypto` to limit a command to one asset type. `fetch --refresh` re-downloads even if the data was fetched today.

Stock data comes from Yahoo Finance through the unofficial `yfinance` library (requests are spaced out, and data is cached in `data/raw/` for the day).

## How it works

| Step | Module | Summary |
|---|---|---|
| Data | `data.py` | Daily OHLCV. Stocks come from Yahoo Finance (NSE, split-adjusted, from 2007, zero-volume closure rows dropped). Crypto comes from Binance's public klines (USDT pairs), closed candles only. Cached as CSV. |
| Features | `features.py` | 19 scale-free indicators: returns, SMA ratios, volatility, RSI, MACD, Bollinger %B, ATR, volume z-score, 52-week position. Past data only, checked by a no-look-ahead test. |
| Target | `features.py` | 1 if the close is higher in 5 trading days, else 0. |
| Models | `models.py` | Logistic regression and a neural network (MLP), against two baselines: always-up and the SMA 20/50 trend rule. One pooled model per asset type. |
| Evaluation | `evaluation.py` | Expanding-window walk-forward with retraining every 63 days. Training rows are dropped if their 5-day outcome overlaps the test window. Reports accuracy, AUC with a block-bootstrap 95% interval, the Brier score, and a cost-aware long/cash backtest against buy-and-hold. |
| Selection | `pipeline.py` | The candidate with the lowest Brier score is chosen, since its probabilities are shown to users as confidence. It only counts as having an edge if the AUC interval excludes 0.5 and its Brier score beats always-up. |
| Ranges | `ranges.py`, `range_pipeline.py` | 80% interval for the close in 5 days: constant, 20-day volatility, GARCH(1,1) (scipy), quantile gradient boosting/XGBoost and a quantile LSTM, scored by coverage and interval score. This is the app's main forecast. |
| Signals | `signals.py` | Volatility ≥ 85% (annualised) → `high_risk`. Otherwise P(up) ≥ 0.55 → `buy`, ≤ 0.45 → `sell`, within 0.03 of either threshold → `watch`, and anything else → `hold`. |
| Publish | `publish.py` | Replaces the backend's prices with the real history, then upserts today's advisories, using the `X-Service-Key` header. |

Design decisions are in `docs/DECISIONS.md`, viva questions in `docs/VIVA_NOTES.md`, and the latest results in `reports/EVALUATION.md`.
