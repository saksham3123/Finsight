"""Technical-indicator features and the prediction target.

Every feature at day t uses only prices up to and including day t (no look-ahead); a unit
test changes future prices and checks that past features do not move. All features are
scale-free (ratios, returns, z-scores) so one model can be trained on many assets at once.
"""

import numpy as np

from .config import HORIZON

FEATURE_NAMES = [
    "ret_1", "ret_5", "ret_10", "ret_20",
    "close_sma10", "close_sma20", "close_sma50", "close_sma200", "sma20_sma50",
    "vol_10", "vol_20", "vol_ratio",
    "rsi_14", "macd_hist", "bollinger_b", "atr_14", "range_1",
    "volume_z20", "pos_52w",
]
WARMUP = 252  # rows needed before every feature is defined (52-week window)


def _rolling(values: np.ndarray, window: int, fn) -> np.ndarray:
    out = np.full(len(values), np.nan)
    if len(values) >= window:
        view = np.lib.stride_tricks.sliding_window_view(values, window)
        out[window - 1:] = fn(view, axis=1)
    return out


def _ema(values: np.ndarray, span: int) -> np.ndarray:
    alpha = 2 / (span + 1)
    out = np.empty(len(values))
    out[0] = values[0]
    for i in range(1, len(values)):
        out[i] = alpha * values[i] + (1 - alpha) * out[i - 1]
    return out


def _rsi(close: np.ndarray, period: int = 14) -> np.ndarray:
    """Wilder's RSI, scaled to 0..1."""
    delta = np.diff(close, prepend=close[0])
    gain, loss = np.clip(delta, 0, None), np.clip(-delta, 0, None)
    out = np.full(len(close), np.nan)
    if len(close) <= period:
        return out
    avg_gain, avg_loss = gain[1:period + 1].mean(), loss[1:period + 1].mean()
    for i in range(period, len(close)):
        if i > period:
            avg_gain = (avg_gain * (period - 1) + gain[i]) / period
            avg_loss = (avg_loss * (period - 1) + loss[i]) / period
        out[i] = 1.0 if avg_loss == 0 else 1 - 1 / (1 + avg_gain / avg_loss)
    return out


def compute_features(series: dict) -> np.ndarray:
    """Returns an (n_days, n_features) matrix; rows inside the warm-up period contain NaN."""
    close, high, low, volume = series["close"], series["high"], series["low"], series["volume"]
    log_close = np.log(close)
    ret1 = np.diff(log_close, prepend=np.nan)

    def lag_return(k):
        out = np.full(len(close), np.nan)
        out[k:] = log_close[k:] - log_close[:-k]
        return out

    sma = {w: _rolling(close, w, np.mean) for w in (10, 20, 50, 200)}
    std20 = _rolling(close, 20, np.std)
    vol10 = _rolling(ret1, 10, np.std)
    vol20 = _rolling(ret1, 20, np.std)

    macd = _ema(close, 12) - _ema(close, 26)
    macd_hist = (macd - _ema(macd, 9)) / close

    prev_close = np.concatenate([[np.nan], close[:-1]])
    true_range = np.nanmax(np.vstack([high - low, np.abs(high - prev_close), np.abs(low - prev_close)]), axis=0)
    atr = _rolling(true_range, 14, np.mean) / close

    log_volume = np.log1p(volume)
    volume_z = (log_volume - _rolling(log_volume, 20, np.mean)) / (_rolling(log_volume, 20, np.std) + 1e-9)

    low52, high52 = _rolling(close, 252, np.min), _rolling(close, 252, np.max)

    columns = {
        "ret_1": ret1,
        "ret_5": lag_return(5),
        "ret_10": lag_return(10),
        "ret_20": lag_return(20),
        "close_sma10": close / sma[10] - 1,
        "close_sma20": close / sma[20] - 1,
        "close_sma50": close / sma[50] - 1,
        "close_sma200": close / sma[200] - 1,
        "sma20_sma50": sma[20] / sma[50] - 1,
        "vol_10": vol10,
        "vol_20": vol20,
        "vol_ratio": vol10 / (vol20 + 1e-12),
        "rsi_14": _rsi(close),
        "macd_hist": macd_hist,
        "bollinger_b": (close - (sma[20] - 2 * std20)) / (4 * std20 + 1e-12),
        "atr_14": atr,
        "range_1": (high - low) / close,
        "volume_z20": volume_z,
        "pos_52w": (close - low52) / (high52 - low52 + 1e-12),
    }
    matrix = np.column_stack([columns[name] for name in FEATURE_NAMES])
    matrix[:WARMUP] = np.nan  # EMA-based features exist earlier but are unstable at the start
    return matrix


def compute_target(close: np.ndarray, horizon: int = HORIZON) -> np.ndarray:
    """1.0 if close[t + horizon] > close[t], else 0.0; NaN for the last `horizon` days (unknown yet)."""
    target = np.full(len(close), np.nan)
    target[:-horizon] = (close[horizon:] > close[:-horizon]).astype(float)
    return target


def annualised_volatility(series: dict, periods_per_year: int, window: int = 30) -> float:
    returns = np.diff(np.log(series["close"][-(window + 1):]))
    return float(np.std(returns) * np.sqrt(periods_per_year))


def build_dataset(series_by_symbol: dict, horizon: int = HORIZON) -> dict:
    """Pools several assets into one labelled dataset, keeping rows where all features and the target exist.

    target_date is the day the outcome becomes known; evaluation uses it to purge training rows
    whose outcome overlaps the test period. "seq" holds the same rows as SEQ_LEN-day windows of
    features for the recurrent models (rows × SEQ_LEN × features). "r_fwd" is the realised 5-day
    log return (the range target) and "row_index" each row's position in its asset's series.
    """
    from .sequence import sequence_windows  # local import: torch is only needed when building sequences

    X, seq, y, r_fwd, row_index, dates, target_dates, symbols = [], [], [], [], [], [], [], []
    for symbol, series in series_by_symbol.items():
        features = compute_features(series)
        target = compute_target(series["close"], horizon)
        valid = ~np.isnan(features).any(axis=1) & ~np.isnan(target)
        idx = np.flatnonzero(valid)
        X.append(features[idx])
        seq.append(sequence_windows(features, idx))
        r_fwd.append(np.log(series["close"][idx + horizon] / series["close"][idx]))
        row_index.append(idx)
        y.append(target[idx])
        dates.append(series["date"][idx])
        target_dates.append(series["date"][idx + horizon])
        symbols.append(np.full(len(idx), symbol))
    return {
        "X": np.vstack(X), "seq": np.concatenate(seq), "y": np.concatenate(y).astype(int),
        "r_fwd": np.concatenate(r_fwd), "row_index": np.concatenate(row_index), "date": np.concatenate(dates),
        "target_date": np.concatenate(target_dates), "symbol": np.concatenate(symbols),
    }
