"""Settings, asset universe and model constants shared by every module."""

import os
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ML_DIR / "data" / "raw"
MODELS_DIR = ML_DIR / "models"
REPORTS_DIR = ML_DIR / "reports"


def _load_dotenv(path: Path) -> None:
    """Minimal .env reader (KEY=VALUE lines) so no extra package is needed. Real env vars win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_dotenv(ML_DIR / ".env")

ALPHAVANTAGE_API_KEY = os.environ.get("ALPHAVANTAGE_API_KEY", "")
FINSIGHT_API_URL = os.environ.get("FINSIGHT_API_URL", "http://localhost:5000/api").rstrip("/")
ML_SERVICE_KEY = os.environ.get("ML_SERVICE_KEY", "")

# Same universe as the backend seed, as Yahoo Finance NSE tickers (e.g. RELIANCE.NS).
STOCKS = {
    "RELIANCE": "RELIANCE.NS",
    "TCS": "TCS.NS",
    "HDFCBANK": "HDFCBANK.NS",
    "INFY": "INFY.NS",
    "ICICIBANK": "ICICIBANK.NS",
    "HINDUNILVR": "HINDUNILVR.NS",
    "ITC": "ITC.NS",
    "SBIN": "SBIN.NS",
    "BHARTIARTL": "BHARTIARTL.NS",
    "LT": "LT.NS",
}
# Yahoo's NSE history before 2007 contains bad ticks (e.g. RELIANCE x4.4 then x0.23 on
# 2005-07-28/29) and rows from before some listings, so stock history starts here.
STOCK_HISTORY_START = "2007-01-01"
# Binance spot pairs quoted in USDT, a USD-pegged stablecoin.
CRYPTOS = {"BTC": "BTCUSDT", "ETH": "ETHUSDT", "SOL": "SOLUSDT", "BNB": "BNBUSDT", "XRP": "XRPUSDT"}

ASSETS = [(s, "stock") for s in STOCKS] + [(s, "crypto") for s in CRYPTOS]

# Prediction target: will the close be higher HORIZON trading days from now?
HORIZON = 5

# Price currency per asset type (Yahoo NSE prices are INR; Binance USDT pairs are treated as USD).
CURRENCY = {"stock": "INR", "crypto": "USD"}

# Trading days per year, for annualising returns and volatility.
PERIODS_PER_YEAR = {"stock": 252, "crypto": 365}

# Probability thresholds that turn P(up) into advisory signals (see signals.py).
BUY_THRESHOLD = 0.55
SELL_THRESHOLD = 0.45
WATCH_MARGIN = 0.03
HIGH_RISK_VOLATILITY = 0.85  # annualised; same cut-off as the backend's baseline engine

# Walk-forward evaluation.
MIN_TRAIN_DAYS = 500   # distinct dates of history before the first test window
TEST_WINDOW_DAYS = 63  # retrain every ~quarter (63 trading days)
COST_PER_TRADE = 0.001  # 0.1% per position change (brokerage/exchange fee estimate)

MODEL_VERSION_PREFIX = "ml-5d"
RANDOM_STATE = 42
