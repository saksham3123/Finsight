"""Writes reports/EVALUATION.md, a human-readable summary of the walk-forward results."""

import json

from . import config
from .ranges import RANGE_LABELS

LABELS = {"always_up": "Always up (baseline)", "sma_trend": "SMA 20/50 trend (baseline)", "logistic": "Logistic regression", "mlp": "Neural network (MLP)",
          "random_forest": "Random forest", "gradient_boosting": "Gradient boosting", "xgboost": "XGBoost", "lstm": "LSTM (recurrent)", "gru": "GRU (recurrent)"}


def _pct(x):
    return "n/a" if x != x else f"{x * 100:.1f}%"


def write_markdown() -> str:
    lines = [
        "# FinSight ML — Walk-forward Evaluation",
        "",
        f"Target: will the close be higher in {config.HORIZON} trading days? Models are retrained every "
        f"{config.TEST_WINDOW_DAYS} trading days on all earlier data, and every number below is out-of-sample.",
        f"Backtest: long when P(up) ≥ {config.BUY_THRESHOLD}, cash when P(up) ≤ {config.SELL_THRESHOLD}, otherwise keep the "
        f"position; {config.COST_PER_TRADE:.1%} cost per trade. Averages are equal-weighted across assets.",
        "",
        "> Past performance in a backtest does not guarantee future results. This is a research prototype, not financial advice.",
        "",
    ]
    for asset_type in ("stock", "crypto"):
        path = config.REPORTS_DIR / f"evaluation_{asset_type}.json"
        if not path.exists():
            continue
        r = json.loads(path.read_text(encoding="utf-8"))
        lines += [
            f"## {asset_type.title()}s ({', '.join(r['assets'])})",
            "",
            f"Out-of-sample period: {r['test_period']['from']} → {r['test_period']['to']}. "
            f"Share of 5-day windows that went up: {_pct(r['results']['always_up']['metrics']['up_rate'])}.",
            "",
            "| Model | Accuracy | Balanced acc. | AUC (95% CI) | Brier | Strategy CAGR | Sharpe | Max drawdown | Time in market |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for name, res in r["results"].items():
            m, b = res["metrics"], res["backtest_avg"]
            marker = " ✅" if name == r["selected_model"] else ""
            lines.append(
                f"| {LABELS.get(name, name)}{marker} | {_pct(m['accuracy'])} | {_pct(m['balanced_accuracy'])} | {m['auc']:.3f} ({m['auc_ci95'][0]:.3f}–{m['auc_ci95'][1]:.3f}) | "
                f"{m['brier']:.4f} | {_pct(b['cagr'])} | {b['sharpe']:.2f} | {_pct(b['max_drawdown'])} | {_pct(b['exposure'])} |"
            )
        bh = r["buy_and_hold_avg"]
        sel = r["results"][r["selected_model"]]["metrics"]
        lines += [
            f"| Buy and hold | — | — | — | — | {_pct(bh['cagr'])} | {bh['sharpe']:.2f} | {_pct(bh['max_drawdown'])} | 100% |",
            "",
            f"Selected model: **{LABELS[r['selected_model']]}** (lowest out-of-sample Brier score). "
            f"AUC {sel['auc']:.3f}, 95% block-bootstrap interval {sel['auc_ci95'][0]:.3f}–{sel['auc_ci95'][1]:.3f}. "
            + ("The interval excludes 0.5 and its probabilities beat the always-up baseline: a small but measurable edge."
               if r["has_reliable_edge"] else
               "⚠️ **No reliable edge**: the interval includes 0.5 (coin-flip level) or its probabilities are no better than the "
               "always-up baseline. Its signals should be read as weak, and most will be 'hold'."),
            "",
            "Per-asset results for the selected model:",
            "",
            "| Asset | Accuracy | Strategy return | Buy-and-hold return | Strategy max DD | Buy-and-hold max DD | Trades |",
            "|---|---|---|---|---|---|---|",
        ]
        for symbol, a in r["results"][r["selected_model"]]["per_asset"].items():
            s, h = a["strategy"], a["buy_and_hold"]
            lines.append(f"| {symbol} | {_pct(a['accuracy'])} | {_pct(s['total_return'])} | {_pct(h['total_return'])} | "
                         f"{_pct(s['max_drawdown'])} | {_pct(h['max_drawdown'])} | {s['trades']} |")
        lines.append("")
    lines += _range_section()
    text = "\n".join(lines) + "\n"
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (config.REPORTS_DIR / "EVALUATION.md").write_text(text, encoding="utf-8")
    return text



def _range_section() -> list[str]:
    """80% range forecasts: coverage should be near 80%; a lower interval score is better."""
    lines = []
    for asset_type in ("stock", "crypto"):
        path = config.REPORTS_DIR / f"range_{asset_type}.json"
        if not path.exists():
            continue
        r = json.loads(path.read_text(encoding="utf-8"))
        if not lines:
            lines += [
                "# Range forecasts (80% interval for the close in 5 trading days)",
                "",
                "Each model predicts the 10th and 90th percentiles of the 5-day return. A well-calibrated 80% range contains "
                "the actual close about 80% of the time. The interval score (Winkler) adds the range width to 10× any miss "
                "distance, so it rewards ranges that are both narrow and honest; lower is better. Skill is the reduction in "
                "interval score versus the constant-range baseline, with a 95% block-bootstrap interval.",
                "",
            ]
        lines += [
            f"## {asset_type.title()}s — ranges",
            "",
            f"Out-of-sample period: {r['test_period']['from']} → {r['test_period']['to']}.",
            "",
            "| Model | Coverage | Below / above | Avg. width | Interval score | Skill vs constant (95% CI) | Skill vs hist. vol (95% CI) |",
            "|---|---|---|---|---|---|---|",
        ]
        for name, res in r["results"].items():
            m = res["metrics"]
            marker = " ✅" if name == r["selected_model"] else ""
            vs_vol = (f"{m['skill_vs_hist_vol'] * 100:+.1f}% ({m['skill_vs_hist_vol_ci95'][0] * 100:+.1f} to {m['skill_vs_hist_vol_ci95'][1] * 100:+.1f})"
                      if "skill_vs_hist_vol" in m else "—")
            lines.append(
                f"| {RANGE_LABELS.get(name, name)}{marker} | {_pct(m['coverage'])} | {_pct(m['below'])} / {_pct(m['above'])} | "
                f"{m['mean_width_pct']:.1f}% | {m['interval_score']:.4f} | "
                f"{m['skill_vs_constant'] * 100:+.1f}% ({m['skill_vs_constant_ci95'][0] * 100:+.1f} to {m['skill_vs_constant_ci95'][1] * 100:+.1f}) | {vs_vol} |"
            )
        paired = [(n, res["metrics"]) for n, res in r["results"].items() if "earnings_gain" in res["metrics"]]
        if paired:
            share = paired[0][1]["share_earnings_windows"]
            lines += [
                "",
                f"Earnings-aware models against the same model without earnings ({share:.1%} of test days had a results "
                "announcement inside the 5-day window). A well-calibrated range should cover about 80% in both groups.",
                "",
                "| Model | Gain vs same model without earnings (95% CI) | Coverage in results weeks: without → with | Coverage in other weeks: without → with |",
                "|---|---|---|---|",
            ]
            for name, m in paired:
                base = r["results"][m["earnings_gain_vs"]]["metrics"]
                lines.append(
                    f"| {RANGE_LABELS.get(name, name)} | {m['earnings_gain'] * 100:+.1f}% ({m['earnings_gain_ci95'][0] * 100:+.1f} to "
                    f"{m['earnings_gain_ci95'][1] * 100:+.1f}) | {_pct(base['coverage_earnings_windows'])} → {_pct(m['coverage_earnings_windows'])} | "
                    f"{_pct(base['coverage_other_windows'])} → {_pct(m['coverage_other_windows'])} |"
                )
        sel = r["results"][r["selected_model"]]["metrics"]
        lines += [
            "",
            f"Selected model: **{RANGE_LABELS[r['selected_model']]}** (lowest interval score). "
            + (f"✅ **Reliable skill**: its interval score is {sel['skill_vs_constant'] * 100:.1f}% better than a constant range, "
               f"and the 95% interval ({sel['skill_vs_constant_ci95'][0] * 100:.1f}% to {sel['skill_vs_constant_ci95'][1] * 100:.1f}%) excludes zero."
               if r["has_reliable_skill"] else
               "⚠️ No reliable skill over a constant range: the 95% interval of the improvement includes zero."),
            "",
        ]
    return lines
