"""High-level steps used by the command line: evaluate, train, predict."""

import json
from datetime import datetime

import joblib
import numpy as np

from . import config
from .data import DataError, load_series
from .evaluation import auc_confidence_interval, backtest_symbol, classification_metrics, out_of_sample_predictions
from .features import FEATURE_NAMES, annualised_volatility, build_dataset, compute_features
from .models import ALL_MODELS, BASELINES, CANDIDATES
from .sequence import sequence_windows
from .signals import confidence, to_signal

ASSET_TYPES = ("stock", "crypto")


def load_universe(asset_type: str, log=print) -> dict:
    series = {}
    for symbol, kind in config.ASSETS:
        if kind != asset_type:
            continue
        try:
            series[symbol] = load_series(symbol, kind)
        except DataError as error:
            log(f"  skipping {symbol}: {error}")
    return series


def _mean(values):
    values = [v for v in values if v == v]  # drop NaN
    return float(np.mean(values)) if values else float("nan")


def evaluate(asset_type: str, models: list[str] | None = None, log=print) -> dict | None:
    """Walk-forward evaluation of every model and baseline for one asset type. Writes reports/evaluation_<type>.json.

    With `models`, only those models (plus the cheap baselines) are evaluated and merged into the existing
    report. That is valid because every model is fitted independently on the same deterministic folds;
    the merge is refused if the existing report was built from a different dataset.
    """
    universe = load_universe(asset_type, log)
    if not universe:
        log(f"  no {asset_type} data; skipped")
        return None
    dataset = build_dataset(universe)
    log(f"  {asset_type}: {len(dataset['y'])} labelled rows from {len(universe)} assets, "
        f"{min(dataset['date'])} → {max(dataset['date'])}")
    previous = None
    if models:
        path = config.REPORTS_DIR / f"evaluation_{asset_type}.json"
        if not path.exists():
            raise DataError(f"No existing {asset_type} evaluation to merge into; run a full `evaluate` first")
        previous = json.loads(path.read_text(encoding="utf-8"))
        models = list(dict.fromkeys([*models, *BASELINES]))
    preds, fold_ids = out_of_sample_predictions(dataset, model_names=models, log=log)
    if previous:
        rows = int((~np.isnan(preds["always_up"])).sum())
        if previous["results"]["always_up"]["metrics"]["rows"] != rows or previous["assets"] != sorted(universe):
            raise DataError(f"The saved {asset_type} evaluation used different data; run a full `evaluate` instead of --models")
    periods = config.PERIODS_PER_YEAR[asset_type]

    results = dict(previous["results"]) if previous else {}
    for name, p in preds.items():
        metrics = classification_metrics(dataset["y"], p)
        metrics["auc_ci95"] = auc_confidence_interval(dataset["y"], p, fold_ids)
        per_asset = {}
        for symbol, series in universe.items():
            mask = dataset["symbol"] == symbol
            bt = backtest_symbol(series, dataset["date"][mask], p[mask], periods)
            if bt:
                bt["accuracy"] = classification_metrics(dataset["y"][mask], p[mask])["accuracy"]
                per_asset[symbol] = bt
        results[name] = {
            "metrics": metrics,
            "backtest_avg": {
                key: _mean([a["strategy"][key] for a in per_asset.values()])
                for key in ("total_return", "cagr", "sharpe", "max_drawdown", "exposure", "trades")
            },
            "per_asset": per_asset,
        }
    buy_hold = {
        key: _mean([a["buy_and_hold"][key] for a in results["always_up"]["per_asset"].values()])
        for key in ("total_return", "cagr", "sharpe", "max_drawdown")
    }

    # Model selection on out-of-sample Brier score: a proper scoring rule, so it rewards probabilities
    # that are both informative and honest. The app shows these probabilities as "confidence", so an
    # over-confident model with a slightly better ranking (AUC) should not win.
    best = min((n for n in CANDIDATES if n in results), key=lambda n: results[n]["metrics"]["brier"])
    chosen = results[best]["metrics"]
    # A reliable edge needs ranking skill that is statistically distinguishable from a coin flip AND
    # probabilities at least as good as simply predicting the historical up-rate.
    has_edge = chosen["auc_ci95"][0] > 0.5 and chosen["brier"] <= results["always_up"]["metrics"]["brier"]
    report = {
        "asset_type": asset_type,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "horizon_days": config.HORIZON,
        "assets": sorted(universe),
        "test_period": {"from": str(min(dataset["date"][~np.isnan(preds["always_up"])])), "to": str(max(dataset["date"]))},
        "results": results,
        "buy_and_hold_avg": buy_hold,
        "selected_model": best,
        "has_reliable_edge": bool(has_edge),
    }
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (config.REPORTS_DIR / f"evaluation_{asset_type}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def train(asset_type: str, model_name: str | None = None, log=print) -> dict | None:
    """Fits the selected model on all labelled history and saves it with its metadata."""
    evaluation_path = config.REPORTS_DIR / f"evaluation_{asset_type}.json"
    evaluation = json.loads(evaluation_path.read_text(encoding="utf-8")) if evaluation_path.exists() else None
    if model_name is None:
        if evaluation is None:
            raise DataError(f"No evaluation for {asset_type}; run `evaluate` first or pass --model")
        model_name = evaluation["selected_model"]
    universe = load_universe(asset_type, log)
    if not universe:
        return None
    dataset = build_dataset(universe)
    model = ALL_MODELS[model_name]()
    if getattr(model, "sequence", False):
        model.fit(dataset["seq"], dataset["y"], dates=dataset["date"])
    else:
        model.fit(dataset["X"], dataset["y"])
    metadata = {
        "asset_type": asset_type,
        "model": model_name,
        "model_version": f"{config.MODEL_VERSION_PREFIX}-{model_name}-{datetime.now():%Y%m%d}",
        "features": FEATURE_NAMES,
        "horizon_days": config.HORIZON,
        "trained_rows": int(len(dataset["y"])),
        "trained_until": str(max(dataset["date"])),
        "walk_forward": evaluation["results"][model_name]["metrics"] if evaluation else None,
    }
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "metadata": metadata}, config.MODELS_DIR / f"{asset_type}.joblib")
    log(f"  {asset_type}: trained {model_name} on {metadata['trained_rows']} rows (data to {metadata['trained_until']})")
    return metadata


def _describe(features: np.ndarray, p_up: float, signal: str, vol: float, meta: dict, last_date: str,
              price_range: tuple | None = None, range_meta: dict | None = None) -> str:
    f = dict(zip(FEATURE_NAMES, features))
    direction = "higher" if p_up >= 0.5 else "lower"
    wf = meta.get("walk_forward") or {}
    parts = []
    # The range leads: it is the forecast with measurable skill. Direction follows, labelled as unproven.
    if price_range:
        rwf = (range_meta or {}).get("walk_forward") or {}
        tested = (f" In walk-forward tests this model's 80% ranges contained the actual close {rwf['coverage']:.0%} of the time"
                  f" (average width {rwf['mean_width_pct']:.1f}% of price).") if rwf else ""
        currency = config.CURRENCY[meta["asset_type"]]
        parts.append(f"80% range for the close in {meta['horizon_days']} trading days: {currency} {price_range[0]:,.2f} to {price_range[1]:,.2f}"
                     f" ({range_meta['model']} model).{tested}")
    parts += [
        f"Direction (no proven edge): model {meta['model']} estimates a {max(p_up, 1 - p_up):.0%} chance the close is {direction} "
        f"in {meta['horizon_days']} trading days (data to {last_date}).",
        f"RSI {f['rsi_14'] * 100:.0f}, price {f['close_sma20'] * 100:+.1f}% vs 20-day SMA and "
        f"{f['close_sma200'] * 100:+.1f}% vs 200-day SMA, 20-day return {f['ret_20'] * 100:+.1f}%, "
        f"annualised volatility {vol * 100:.0f}%.",
    ]
    if signal == "high_risk":
        parts.append("Volatility is above the high-risk cut-off, so the model's direction is overridden.")
    if wf:
        parts.append(f"Direction walk-forward test: {wf['accuracy']:.1%} accuracy, AUC {wf['auc']:.3f} "
                     f"(always-up baseline {wf['up_rate']:.1%}).")
    return " ".join(parts)


def predict(log=print) -> list[dict]:
    """Scores the latest day of every asset with its type's saved model. Writes reports/predictions.json."""
    today = datetime.now().strftime("%Y-%m-%d")
    advisories = []
    for asset_type in ASSET_TYPES:
        path = config.MODELS_DIR / f"{asset_type}.joblib"
        if not path.exists():
            log(f"  no {asset_type} model; run `train` first")
            continue
        bundle = joblib.load(path)
        model, meta = bundle["model"], bundle["metadata"]
        from .range_pipeline import load_range_model, predict_range  # local: range_pipeline imports this module
        range_bundle = load_range_model(asset_type)
        for symbol, series in load_universe(asset_type, log).items():
            features = compute_features(series)[-1]
            if np.isnan(features).any():
                log(f"  {symbol}: not enough history to score")
                continue
            if getattr(model, "sequence", False):
                all_features = compute_features(series)
                window = sequence_windows(all_features, np.array([len(all_features) - 1]))
                p_up = float(model.predict_proba(window)[0, 1])
            else:
                p_up = float(model.predict_proba(features.reshape(1, -1))[0, 1])
            vol = annualised_volatility(series, config.PERIODS_PER_YEAR[asset_type])
            signal = to_signal(p_up, vol)
            last_date = str(series["date"][-1])
            price_range = predict_range(range_bundle, symbol, series) if range_bundle else None
            range_meta = range_bundle["metadata"] if range_bundle else None
            advisories.append({
                "symbol": symbol,
                "assetType": asset_type,
                # Dated today so it supersedes today's rule-based baseline advisory in the backend.
                "date": today,
                "signal": signal,
                "probabilityUp": round(p_up, 4),
                "confidence": round(confidence(p_up), 4),
                "riskScore": round(min(vol, 1.0), 4),
                "rationale": _describe(features, p_up, signal, vol, meta, last_date, price_range, range_meta),
                **({"priceLow": round(price_range[0], 8), "priceHigh": round(price_range[1], 8), "rangeLevel": range_meta["level"],
                    "horizonDays": meta["horizon_days"], "rangeModelVersion": range_meta["model_version"]} if price_range else {}),
                "modelVersion": meta["model_version"],
                "dataUntil": last_date,
            })
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (config.REPORTS_DIR / "predictions.json").write_text(json.dumps(advisories, indent=2), encoding="utf-8")
    return advisories
