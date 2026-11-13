"""Walk-forward evaluation and trading backtest.

Walk-forward = repeatedly train on the past and test on the next unseen window, like the model
would be used in real life. Random train/test splits are wrong for time series: they let the
model learn from the future.
"""

import numpy as np
from sklearn.metrics import accuracy_score, balanced_accuracy_score, brier_score_loss, log_loss, roc_auc_score

from . import config
from .models import ALL_MODELS


def walk_forward_folds(dates: np.ndarray, target_dates: np.ndarray,
                       min_train_days: int = config.MIN_TRAIN_DAYS, test_days: int = config.TEST_WINDOW_DAYS):
    """Yields (train_idx, test_idx) with an expanding training window.

    Purging: a training row is used only if its outcome date is before the test window starts.
    Without this, the last training rows' 5-day targets would overlap the test period (leakage).
    """
    unique_dates = np.unique(dates)
    for start in range(min_train_days, len(unique_dates), test_days):
        test_start = unique_dates[start]
        test_end = unique_dates[min(start + test_days, len(unique_dates)) - 1]
        train_idx = np.flatnonzero(target_dates < test_start)
        test_idx = np.flatnonzero((dates >= test_start) & (dates <= test_end))
        if len(train_idx) and len(test_idx):
            yield train_idx, test_idx


def out_of_sample_predictions(dataset: dict, model_names=None, log=None) -> tuple[dict, np.ndarray]:
    """Returns ({model_name: P(up) per row}, fold number per row). Rows never tested hold NaN / -1."""
    model_names = model_names or list(ALL_MODELS)
    X, seq, y = dataset["X"], dataset["seq"], dataset["y"]
    preds = {name: np.full(len(y), np.nan) for name in model_names}
    fold_ids = np.full(len(y), -1)
    folds = list(walk_forward_folds(dataset["date"], dataset["target_date"]))
    for i, (train_idx, test_idx) in enumerate(folds, 1):
        fold_ids[test_idx] = i
        for name in model_names:
            model = ALL_MODELS[name]()
            if getattr(model, "sequence", False):
                model.fit(seq[train_idx], y[train_idx], dates=dataset["date"][train_idx])
                preds[name][test_idx] = model.predict_proba(seq[test_idx])[:, 1]
            else:
                model.fit(X[train_idx], y[train_idx])
                preds[name][test_idx] = model.predict_proba(X[test_idx])[:, 1]
        if log and (i % 5 == 0 or i == len(folds)):
            log(f"    fold {i}/{len(folds)}")
    return preds, fold_ids


def auc_confidence_interval(y: np.ndarray, p: np.ndarray, fold_ids: np.ndarray, n_boot: int = 500, seed: int = 0):
    """95% block-bootstrap interval for AUC. Whole test windows are resampled, not single rows:
    neighbouring days share overlapping 5-day outcomes, so row-level resampling would be overconfident."""
    mask = ~np.isnan(p)
    y, p, fold_ids = y[mask], p[mask], fold_ids[mask]
    if len(np.unique(p)) < 2:
        return (0.5, 0.5)
    blocks = [np.flatnonzero(fold_ids == f) for f in np.unique(fold_ids)]
    rng = np.random.default_rng(seed)
    aucs = []
    for _ in range(n_boot):
        idx = np.concatenate([blocks[i] for i in rng.integers(0, len(blocks), len(blocks))])
        if len(np.unique(y[idx])) == 2 and len(np.unique(p[idx])) > 1:
            aucs.append(roc_auc_score(y[idx], p[idx]))
    return (float(np.percentile(aucs, 2.5)), float(np.percentile(aucs, 97.5)))


def classification_metrics(y: np.ndarray, p: np.ndarray) -> dict:
    mask = ~np.isnan(p)
    y, p = y[mask], np.clip(p[mask], 1e-6, 1 - 1e-6)
    predicted = (p >= 0.5).astype(int)
    single_class = len(np.unique(predicted)) == 1
    return {
        "rows": int(len(y)),
        "accuracy": float(accuracy_score(y, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(y, predicted)),
        # AUC needs varying scores; a constant predictor (always_up) has no ranking ability.
        "auc": float(roc_auc_score(y, p)) if len(np.unique(p)) > 1 else 0.5,
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "up_rate": float(np.mean(y)),
        "predicts_one_class": single_class,
    }


def positions_from_probabilities(p: np.ndarray) -> np.ndarray:
    """Long-or-cash strategy with hysteresis, matching the advisory signals:
    buy (p >= BUY) → go long; sell (p <= SELL) → go to cash; hold/watch → keep the current position."""
    position = np.zeros(len(p))
    current = 0.0
    for i, prob in enumerate(p):
        if np.isnan(prob):
            current = 0.0
        elif prob >= config.BUY_THRESHOLD:
            current = 1.0
        elif prob <= config.SELL_THRESHOLD:
            current = 0.0
        position[i] = current
    return position


def backtest(close: np.ndarray, position: np.ndarray, periods_per_year: int, cost: float = config.COST_PER_TRADE) -> dict:
    """The position decided at day t's close earns the return from t to t+1, minus costs on every change."""
    daily_returns = close[1:] / close[:-1] - 1
    held = position[:-1]
    trades = np.abs(np.diff(np.concatenate([[0.0], held])))
    strategy = held * daily_returns - trades * cost
    equity = np.cumprod(1 + strategy)
    years = len(strategy) / periods_per_year
    # Include the starting capital (1.0) so a loss from day one counts as a drawdown.
    path = np.concatenate([[1.0], equity])
    peak = np.maximum.accumulate(path)
    std = np.std(strategy)
    return {
        "total_return": float(equity[-1] - 1),
        "cagr": float(equity[-1] ** (1 / years) - 1) if years > 0 and equity[-1] > 0 else float("nan"),
        "sharpe": float(np.mean(strategy) / std * np.sqrt(periods_per_year)) if std > 0 else 0.0,
        "max_drawdown": float(np.min(path / peak - 1)),
        "exposure": float(np.mean(held)),
        "trades": int(np.sum(trades > 0)),
    }


def backtest_symbol(series: dict, row_dates: np.ndarray, probabilities: np.ndarray, periods_per_year: int) -> dict:
    """Backtests one asset over the dates it has out-of-sample predictions for, against buy-and-hold."""
    mask = ~np.isnan(probabilities)
    tested_dates, tested_p = row_dates[mask], probabilities[mask]
    if len(tested_dates) < 2:
        return {}
    index = {d: i for i, d in enumerate(series["date"])}
    rows = np.array([index[d] for d in tested_dates])
    # Price path from the first tested day to the day after the last one.
    span = np.arange(rows[0], min(rows[-1] + 2, len(series["close"])))
    p_span = np.full(len(span), np.nan)
    p_span[rows - rows[0]] = tested_p
    close = series["close"][span]
    strategy = backtest(close, positions_from_probabilities(p_span), periods_per_year)
    buy_hold = backtest(close, np.ones(len(close)), periods_per_year, cost=0.0)
    return {"from": series["date"][span[0]], "to": series["date"][span[-1]], "strategy": strategy, "buy_and_hold": buy_hold}
