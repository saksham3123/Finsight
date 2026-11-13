"""Downloading, caching and loading daily OHLCV price history.

Series are plain dicts of numpy arrays (pandas is blocked by Windows Smart App Control on
the development machine):  {"date": str[], "open", "high", "low", "close", "volume": float[]}
"""

import csv
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import requests

from . import config

COLUMNS = ["date", "open", "high", "low", "close", "volume"]
TIMEOUT = 30


class DataError(RuntimeError):
    pass


def cache_path(symbol: str, asset_type: str):
    return config.DATA_DIR / f"{symbol}_{asset_type}.csv"


# --------------------------------------------------------------------------- sources

NSE_CLOSE_IST = (15, 30)
IST = timezone(timedelta(hours=5, minutes=30))


def rows_from_yahoo_history(history, now: datetime | None = None) -> list[dict]:
    """Converts a yfinance history DataFrame to rows. Yahoo's Open/High/Low/Close are already
    split-adjusted (not dividend-adjusted). While NSE is still trading, today's row is a partial
    candle, so it is dropped until after the 15:30 IST close."""
    now = now or datetime.now(IST)
    today = now.strftime("%Y-%m-%d")
    market_closed = (now.hour, now.minute) >= NSE_CLOSE_IST
    rows = []
    for timestamp, r in history.iterrows():
        day = timestamp.strftime("%Y-%m-%d")
        if day == today and not market_closed:
            continue
        values = [r["Open"], r["High"], r["Low"], r["Close"], r["Volume"]]
        if any(v != v for v in values):  # NaN: Yahoo occasionally has holes
            continue
        rows.append({"date": day, "open": float(r["Open"]), "high": float(r["High"]), "low": float(r["Low"]),
                     "close": float(r["Close"]), "volume": float(r["Volume"])})
    return rows


def fetch_yahoo(ticker: str) -> list[dict]:
    """Full daily history from Yahoo Finance via the unofficial yfinance library (chosen by the user
    after Alpha Vantage moved full history to its paid plan). Imported lazily so the rest of the
    pipeline works even if yfinance is missing."""
    try:
        import yfinance as yf
    except ImportError as error:
        raise DataError(f"yfinance is not available ({error}). Run: .venv\\Scripts\\python -m pip install -r requirements.txt") from error
    try:
        history = yf.Ticker(ticker).history(period="max", interval="1d", auto_adjust=False, actions=False)
    except Exception as error:  # yfinance raises many library-specific errors (rate limits, network)
        raise DataError(f"Yahoo Finance ({ticker}): {error}") from error
    if history is None or history.empty:
        raise DataError(f"Yahoo Finance ({ticker}): no data returned (ticker wrong, or temporarily rate-limited)")
    return rows_from_yahoo_history(history)


def fetch_earnings_dates(ticker: str) -> list[str]:
    """Results-announcement dates (IST, YYYY-MM-DD), past and scheduled, from Yahoo via yfinance.
    About four a year back to ~2005. Indian listed companies must give at least five days' notice
    of the board meeting that approves results (SEBI LODR Regulation 29), so a date inside the
    next 5 trading days is public on the forecast day."""
    import yfinance as yf
    try:
        frame = yf.Ticker(ticker).get_earnings_dates(limit=100)
    except Exception as error:  # yfinance raises many library-specific errors (rate limits, network)
        raise DataError(f"Yahoo earnings dates ({ticker}): {error}") from error
    if frame is None or frame.empty:
        raise DataError(f"Yahoo earnings dates ({ticker}): none returned")
    days = {(ts.tz_convert("Asia/Kolkata") if ts.tzinfo else ts).strftime("%Y-%m-%d") for ts in frame.index}
    return sorted(days)


def earnings_path(symbol: str):
    return config.DATA_DIR / f"{symbol}_earnings.csv"


def save_earnings(symbol: str, dates: list[str]) -> None:
    path = earnings_path(symbol)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("date\n" + "\n".join(dates) + "\n", encoding="utf-8")


def load_earnings(symbol: str) -> list[str] | None:
    """Cached results dates for a stock, or None if they were never fetched."""
    path = earnings_path(symbol)
    if not path.exists():
        return None
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines()[1:] if line.strip()]


def fetch_binance(pair: str, start: str = "2017-01-01") -> list[dict]:
    """Daily klines from Binance's public API, paginated 1000 days at a time.
    The current day's candle is still forming, so only fully closed candles are kept."""
    start_ms = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp() * 1000)
    now_ms = int(time.time() * 1000)
    rows = []
    while True:
        response = requests.get(
            "https://api.binance.com/api/v3/klines",
            params={"symbol": pair, "interval": "1d", "startTime": start_ms, "limit": 1000},
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        klines = response.json()
        if not klines:
            break
        for k in klines:
            open_time, o, h, l, c, v, close_time = k[0], k[1], k[2], k[3], k[4], k[5], k[6]
            if close_time >= now_ms:
                continue
            day = datetime.fromtimestamp(open_time / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            rows.append({"date": day, "open": float(o), "high": float(h), "low": float(l), "close": float(c), "volume": float(v)})
        if len(klines) < 1000:
            break
        start_ms = klines[-1][0] + 1
        time.sleep(0.2)
    return rows


# --------------------------------------------------------------------------- cleaning

SPLIT_FACTORS = (2, 3, 4, 5, 10)


def adjust_for_splits(rows: list[dict]) -> tuple[list[dict], list[str]]:
    """Alpha Vantage's free daily series is not split-adjusted, so a 1:1 bonus issue looks like a
    50% crash. An overnight drop whose open/previous-close ratio is within 3% of 1/k (k = 2, 3, 4,
    5, 10) is treated as a split, and every earlier price is divided by k (volume multiplied by k)."""
    rows = [dict(r) for r in rows]
    events = []
    for i in range(1, len(rows)):
        ratio = rows[i]["open"] / rows[i - 1]["close"]
        for k in SPLIT_FACTORS:
            if abs(ratio * k - 1) < 0.03:
                for j in range(i):
                    for col in ("open", "high", "low", "close"):
                        rows[j][col] /= k
                    rows[j]["volume"] *= k
                events.append(f"{rows[i]['date']} 1:{k}")
                break
    return rows, events


def trim_stock_history(rows: list[dict]) -> list[dict]:
    """Keeps Yahoo stock rows from STOCK_HISTORY_START on, minus zero-volume rows: Yahoo fills
    exchange closures (e.g. 2008-11-27) with flat placeholder candles that never traded."""
    return [r for r in rows if r["date"] >= config.STOCK_HISTORY_START and r["volume"] > 0]


def clean(rows: list[dict]) -> list[dict]:
    """Drops duplicate dates and rows with non-positive or inconsistent prices."""
    seen, out = set(), []
    for r in sorted(rows, key=lambda r: r["date"]):
        if r["date"] in seen:
            continue
        if min(r["open"], r["high"], r["low"], r["close"]) <= 0 or r["high"] < r["low"]:
            continue
        seen.add(r["date"])
        out.append(r)
    return out


# --------------------------------------------------------------------------- cache

def save_rows(path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def load_series(symbol: str, asset_type: str) -> dict:
    path = cache_path(symbol, asset_type)
    if not path.exists():
        raise DataError(f"No cached data for {symbol} ({asset_type}). Run: python -m finsight_ml fetch")
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    series = {"date": np.array([r["date"] for r in rows])}
    for col in COLUMNS[1:]:
        series[col] = np.array([float(r[col]) for r in rows])
    return series


def fetch_all(refresh: bool = False, only_type: str | None = None, log=print) -> dict:
    """Downloads every asset (or one asset type) unless the cache was written today."""
    summary = {"fetched": [], "cached": [], "failed": []}
    today = datetime.now().strftime("%Y-%m-%d")
    for symbol, asset_type in config.ASSETS:
        if only_type and asset_type != only_type:
            continue
        path = cache_path(symbol, asset_type)
        if not refresh and path.exists() and datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d") == today:
            summary["cached"].append(symbol)
            continue
        try:
            if asset_type == "stock":
                try:
                    # Yahoo prices are already split-adjusted, so adjust_for_splits is not applied.
                    rows, splits = clean(trim_stock_history(fetch_yahoo(config.STOCKS[symbol]))), []
                    try:
                        save_earnings(symbol, fetch_earnings_dates(config.STOCKS[symbol]))
                    except DataError as error:  # prices are still usable; earnings-aware range models fall back
                        log(f"  {symbol:<11} earnings dates not updated: {error}")
                finally:
                    time.sleep(1.5)  # space out requests to avoid Yahoo's rate limiting, even after a failure
            else:
                rows, splits = clean(fetch_binance(config.CRYPTOS[symbol])), []
            save_rows(path, rows)
            summary["fetched"].append(symbol)
            note = f", split-adjusted {', '.join(splits)}" if splits else ""
            log(f"  {symbol:<11} {len(rows):>5} days  {rows[0]['date']} → {rows[-1]['date']}{note}")
        except (DataError, requests.RequestException) as error:
            summary["failed"].append(symbol)
            message = str(error)
            log(f"  {symbol:<11} FAILED: {message}")
            # Applies to every stock, so retrying the rest immediately would only make it worse.
            if "rate limit" in message.lower() or "too many requests" in message.lower():
                log("  Yahoo is rate-limiting requests; remaining stocks skipped. Try again in an hour (cached data is still used).")
                break
    return summary
