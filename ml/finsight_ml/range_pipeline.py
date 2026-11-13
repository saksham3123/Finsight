"""Evaluate, train and apply the range models in ranges.py (80% interval for the close in 5 days).

Uses the same pooled datasets and purged walk-forward folds as the direction models, so the two
sets of results describe exactly the same out-of-sample days.
"""

import json
from datetime import datetime

import joblib
import numpy as np

from . import config
from .data import DataError, load_earnings
from .evaluation import walk_forward_folds
from .features import build_dataset, compute_features
from .pipeline import load_universe
from .ranges import (EARNINGS_BASE, LEVEL, RANGE_BASELINE, RANGE_MODELS, fit_garch, garch_scale, hist_vol_scale, interval_score,
                     range_metrics, skill_interval)
from .sequence import sequence_windows


def earnings_window_flags(dates: np.ndarray, earnings: list[str], horizon: int = config.HORIZON) -> np.ndarray:
    """1.0 for each day t whose 5-day return window is affected by a results announcement.

    An announcement on date e first moves the price on its first trading day on or after e (index
    i_e), or the day after if it was released after the close. The return from t to t + horizon
    covers days t + 1 … t + horizon, so it is affected when t ≤ i_e ≤ t + horizon.
    """
    flags = np.zeros(len(dates))
    for event in np.searchsorted(dates, [e for e in earnings if dates[0] <= e <= dates[-1]]):
        flags[max(0, event - horizon): event + 1] = 1.0
    return flags


def _earnings_flags(universe, dataset, log=print) -> np.ndarray:
    flags = np.zeros(len(dataset["y"]))
    for symbol, series in universe.items():
        earnings = load_earnings(symbol) if symbol in config.STOCKS else []
        if earnings is None:
            log(f"  {symbol}: no cached earnings dates (run fetch); earnings models treat it as never reporting")
            earnings = []
        rows = dataset["symbol"] == symbol
        flags[rows] = earnings_window_flags(series["date"], earnings)[dataset["row_index"][rows]]
    return flags


def _daily_returns(series):
    return np.diff(np.log(series["close"]), prepend=np.nan)


def _garch_scales(universe, dataset, before: str | None) -> tuple[np.ndarray, dict]:
    """GARCH 5-day volatility for every dataset row. Parameters are fitted per asset on returns
    dated before `before` (the test window's first day), or on all data when `before` is None."""
    scales = np.full(len(dataset["y"]), np.nan)
    params = {}
    for symbol, series in universe.items():
        returns = _daily_returns(series)
        train = returns if before is None else returns[series["date"] < before]
        params[symbol] = fit_garch(train)
        rows = dataset["symbol"] == symbol
        scales[rows] = garch_scale(returns, params[symbol])[dataset["row_index"][rows]]
    return scales, params


def _inputs(model, dataset):
    """Earnings models get the earnings-window flag appended to the indicators as the last column."""
    if getattr(model, "earnings", False):
        return np.column_stack([dataset["X"], dataset["earnings"]])
    return dataset["X"]


def _fit_predict(name, dataset, scales, train_idx, test_idx):
    model = RANGE_MODELS[name]()
    s = scales[model.scale]
    y = dataset["r_fwd"]
    if getattr(model, "sequence", False):
        model.fit(dataset["seq"][train_idx], y[train_idx], s[train_idx], dates=dataset["date"][train_idx])
        return model.predict(dataset["seq"][test_idx], s[test_idx])
    X = _inputs(model, dataset)
    model.fit(X[train_idx], y[train_idx], s[train_idx])
    return model.predict(X[test_idx], s[test_idx])


def evaluate_range(asset_type: str, models: list[str] | None = None, log=print) -> dict | None:
    """Walk-forward evaluation of every range model. Writes reports/range_<type>.json."""
    universe = load_universe(asset_type, log)
    if not universe:
        log(f"  no {asset_type} data; skipped")
        return None
    dataset = build_dataset(universe)
    dataset["earnings"] = _earnings_flags(universe, dataset, log)
    names = list(dict.fromkeys([RANGE_BASELINE, *(models or RANGE_MODELS)]))
    y, n = dataset["r_fwd"], len(dataset["y"])
    lo = {name: np.full(n, np.nan) for name in names}
    hi = {name: np.full(n, np.nan) for name in names}
    fold_ids = np.full(n, -1)
    folds = list(walk_forward_folds(dataset["date"], dataset["target_date"]))
    log(f"  {asset_type}: {n} rows, {len(folds)} folds, models: {', '.join(names)}")
    for i, (train_idx, test_idx) in enumerate(folds, 1):
        fold_ids[test_idx] = i
        garch, _ = _garch_scales(universe, dataset, before=str(min(dataset["date"][test_idx])))
        scales = {"one": np.ones(n), "vol": hist_vol_scale(dataset["X"]), "garch": garch}
        for name in names:
            lo[name][test_idx], hi[name][test_idx] = _fit_predict(name, dataset, scales, train_idx, test_idx)
        if i % 5 == 0 or i == len(folds):
            log(f"    fold {i}/{len(folds)}")

    tested = fold_ids >= 0
    base_score = interval_score(lo[RANGE_BASELINE][tested], hi[RANGE_BASELINE][tested], y[tested])
    vol_score = interval_score(lo["hist_vol"][tested], hi["hist_vol"][tested], y[tested]) if "hist_vol" in names else None
    results = {}
    for name in names:
        score = interval_score(lo[name][tested], hi[name][tested], y[tested])
        metrics = range_metrics(lo[name][tested], hi[name][tested], y[tested])
        metrics["skill_vs_constant"], metrics["skill_vs_constant_ci95"] = skill_interval(score, base_score, fold_ids[tested])
        if vol_score is not None:
            metrics["skill_vs_hist_vol"], metrics["skill_vs_hist_vol_ci95"] = skill_interval(score, vol_score, fold_ids[tested])
        # Accuracy inside and outside results weeks: a range that ignores earnings should be too narrow there.
        in_window = dataset["earnings"][tested] > 0.5
        metrics["share_earnings_windows"] = float(np.mean(in_window))
        if in_window.any():
            metrics["coverage_earnings_windows"] = float(np.mean((y[tested] >= lo[name][tested]) & (y[tested] <= hi[name][tested]) & in_window) / np.mean(in_window))
            metrics["coverage_other_windows"] = float(np.mean((y[tested] >= lo[name][tested]) & (y[tested] <= hi[name][tested]) & ~in_window) / np.mean(~in_window))
        base = EARNINGS_BASE.get(name)
        if base in names:
            # A separate name: `base_score` is the constant baseline, used by every later model's skill.
            paired_score = interval_score(lo[base][tested], hi[base][tested], y[tested])
            metrics["earnings_gain_vs"] = base
            metrics["earnings_gain"], metrics["earnings_gain_ci95"] = skill_interval(score, paired_score, fold_ids[tested])
        per_asset = {}
        for symbol in universe:
            rows = tested & (dataset["symbol"] == symbol)
            per_asset[symbol] = range_metrics(lo[name][rows], hi[name][rows], y[rows])
        results[name] = {"metrics": metrics, "per_asset": per_asset}

    if models:  # merge into the saved report (same rule as `evaluate --models`)
        path = config.REPORTS_DIR / f"range_{asset_type}.json"
        if not path.exists():
            raise DataError(f"No saved {asset_type} range evaluation to merge into; run without --models first")
        previous = json.loads(path.read_text(encoding="utf-8"))
        if previous["results"][RANGE_BASELINE]["metrics"]["rows"] != int(tested.sum()) or previous["assets"] != sorted(universe):
            raise DataError(f"The saved {asset_type} range evaluation used different data; run it in full")
        results = {**previous["results"], **results}

    candidates = [m for m in results if m != RANGE_BASELINE]
    best = min(candidates, key=lambda m: results[m]["metrics"]["interval_score"])
    best_metrics = results[best]["metrics"]
    report = {
        "asset_type": asset_type,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "horizon_days": config.HORIZON,
        "level": LEVEL,
        "assets": sorted(universe),
        "test_period": {"from": str(min(dataset["date"][tested])), "to": str(max(dataset["date"][tested]))},
        "results": results,
        "selected_model": best,
        # Skill is "reliable" when the 95% interval of the improvement over the constant range excludes 0.
        "has_reliable_skill": bool(best_metrics["skill_vs_constant_ci95"][0] > 0),
    }
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (config.REPORTS_DIR / f"range_{asset_type}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def train_range(asset_type: str, model_name: str | None = None, log=print) -> dict | None:
    """Fits the selected range model on all history. Writes models/range_<type>.joblib."""
    path = config.REPORTS_DIR / f"range_{asset_type}.json"
    evaluation = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    if model_name is None:
        if evaluation is None:
            log(f"  {asset_type}: no range evaluation; skipped (run `range-evaluate`)")
            return None
        model_name = evaluation["selected_model"]
    universe = load_universe(asset_type, log)
    if not universe:
        return None
    dataset = build_dataset(universe)
    dataset["earnings"] = _earnings_flags(universe, dataset, log)
    garch, garch_params = _garch_scales(universe, dataset, before=None)
    scales = {"one": np.ones(len(dataset["y"])), "vol": hist_vol_scale(dataset["X"]), "garch": garch}
    all_rows = np.arange(len(dataset["y"]))
    model = RANGE_MODELS[model_name]()
    s = scales[model.scale]
    if getattr(model, "sequence", False):
        model.fit(dataset["seq"], dataset["r_fwd"], s, dates=dataset["date"])
    else:
        model.fit(_inputs(model, dataset), dataset["r_fwd"], s)
    metadata = {
        "asset_type": asset_type,
        "model": model_name,
        "model_version": f"range-5d-{model_name}-{datetime.now():%Y%m%d}",
        "level": LEVEL,
        "trained_rows": int(len(all_rows)),
        "trained_until": str(max(dataset["date"])),
        "walk_forward": evaluation["results"][model_name]["metrics"] if evaluation else None,
    }
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "garch_params": garch_params, "metadata": metadata}, config.MODELS_DIR / f"range_{asset_type}.joblib")
    log(f"  {asset_type}: trained range model {model_name} on {len(all_rows)} rows")
    return metadata


def load_range_model(asset_type: str):
    path = config.MODELS_DIR / f"range_{asset_type}.joblib"
    return joblib.load(path) if path.exists() else None


def upcoming_earnings(symbol: str, last_date: str, horizon: int = config.HORIZON) -> str | None:
    """A scheduled results date from the last close up to `horizon` weekdays later, if any.
    (Exchange holidays aren't known here, so this counts weekdays as trading days.)"""
    dates = load_earnings(symbol) if symbol in config.STOCKS else None
    if not dates:
        return None
    end = np.busday_offset(np.datetime64(last_date), horizon, roll="forward")
    return next((d for d in dates if last_date <= d <= str(end)), None)


def predict_range(bundle: dict, symbol: str, series: dict) -> tuple[float, float] | None:
    """80% price range for the close in 5 trading days, from the latest day's data."""
    features = compute_features(series)
    if np.isnan(features[-1]).any():
        return None
    model = bundle["model"]
    last = np.array([len(features) - 1])
    if model.scale == "garch":
        params = bundle["garch_params"].get(symbol) or fit_garch(_daily_returns(series))
        s = garch_scale(_daily_returns(series), params)[last]
    elif model.scale == "vol":
        s = hist_vol_scale(features[last])
    else:
        s = np.ones(1)
    X = sequence_windows(features, last) if getattr(model, "sequence", False) else features[last]
    if getattr(model, "earnings", False):
        X = np.column_stack([X, [1.0 if upcoming_earnings(symbol, str(series["date"][-1])) else 0.0]])
    lo, hi = model.predict(X, s)
    close = float(series["close"][-1])
    return close * float(np.exp(lo[0])), close * float(np.exp(hi[0]))
