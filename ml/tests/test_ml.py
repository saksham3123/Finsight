"""Unit tests for the ML pipeline. Run from ml/: .venv\\Scripts\\python -m unittest -v"""

import unittest

import numpy as np

from finsight_ml import config
from finsight_ml.data import adjust_for_splits, clean, rows_from_yahoo_history, trim_stock_history
from finsight_ml.evaluation import (auc_confidence_interval, backtest, classification_metrics,
                                    positions_from_probabilities, walk_forward_folds)
from finsight_ml.features import FEATURE_NAMES, WARMUP, build_dataset, compute_features, compute_target
from finsight_ml.models import AlwaysUp, SmaTrend, gradient_boosting, logistic, random_forest, xgboost
from finsight_ml.sequence import RecurrentClassifier, sequence_windows
from finsight_ml.range_pipeline import earnings_window_flags
from finsight_ml.ranges import EarningsScaledQuantiles, QuantileTrees, ScaledQuantiles, fit_garch, garch_scale, interval_score, range_metrics, skill_interval
from finsight_ml.signals import confidence, to_signal


def make_series(n=400, seed=0, drift=0.0005):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(drift + rng.normal(0, 0.01, n)))
    dates = np.array([str(np.datetime64("2020-01-01") + np.timedelta64(i, "D")) for i in range(n)])
    return {"date": dates, "open": close * 0.999, "high": close * 1.01, "low": close * 0.99,
            "close": close, "volume": rng.uniform(1e5, 2e5, n)}


class FeatureTests(unittest.TestCase):
    def test_shape_and_warmup(self):
        f = compute_features(make_series())
        self.assertEqual(f.shape, (400, len(FEATURE_NAMES)))
        self.assertTrue(np.isnan(f[:WARMUP]).all())
        self.assertFalse(np.isnan(f[WARMUP:]).any())

    def test_no_look_ahead(self):
        """Changing prices after day t must not change any feature at or before day t."""
        series = make_series()
        before = compute_features(series)
        t = 300
        altered = {k: v.copy() for k, v in series.items()}
        for col in ("open", "high", "low", "close"):
            altered[col][t + 1:] *= 3.0
        altered["volume"][t + 1:] *= 10
        after = compute_features(altered)
        np.testing.assert_allclose(before[: t + 1], after[: t + 1], equal_nan=True)

    def test_target(self):
        close = np.array([1, 2, 3, 2, 1, 5, 6, 0.5, 9.0])
        target = compute_target(close, horizon=2)
        np.testing.assert_array_equal(target[:-2], [1, 0, 0, 1, 1, 0, 1])
        self.assertTrue(np.isnan(target[-2:]).all())

    def test_dataset_target_dates_are_horizon_ahead(self):
        series = make_series()
        ds = build_dataset({"A": series})
        index = {d: i for i, d in enumerate(series["date"])}
        gaps = {index[t] - index[d] for d, t in zip(ds["date"], ds["target_date"])}
        self.assertEqual(gaps, {config.HORIZON})


class WalkForwardTests(unittest.TestCase):
    def test_purged_and_ordered(self):
        ds = build_dataset({"A": make_series(900, 1), "B": make_series(900, 2)})
        folds = list(walk_forward_folds(ds["date"], ds["target_date"], min_train_days=200, test_days=50))
        self.assertGreater(len(folds), 3)
        for train_idx, test_idx in folds:
            test_start = min(ds["date"][test_idx])
            # No training row's outcome may be known only on/after the test window starts.
            self.assertTrue((ds["target_date"][train_idx] < test_start).all())
            self.assertTrue((ds["date"][train_idx] < test_start).all())

    def test_test_windows_do_not_overlap(self):
        ds = build_dataset({"A": make_series(900, 3)})
        seen = set()
        for _, test_idx in walk_forward_folds(ds["date"], ds["target_date"], min_train_days=200, test_days=50):
            self.assertFalse(seen & set(test_idx))
            seen |= set(test_idx)


class ModelTests(unittest.TestCase):
    def test_always_up_predicts_training_up_rate(self):
        model = AlwaysUp().fit(np.zeros((4, 2)), np.array([1, 1, 1, 0]))
        np.testing.assert_allclose(model.predict_proba(np.zeros((2, 2)))[:, 1], 0.75)

    def test_sma_trend(self):
        X = np.zeros((2, len(FEATURE_NAMES)))
        X[0, SmaTrend.column], X[1, SmaTrend.column] = 0.05, -0.05
        np.testing.assert_allclose(SmaTrend().fit(X, None).predict_proba(X)[:, 1], [0.6, 0.4])

    def test_logistic_learns_a_real_signal(self):
        rng = np.random.default_rng(0)
        X = rng.normal(size=(2000, 3))
        y = (X[:, 0] + rng.normal(0, 0.5, 2000) > 0).astype(int)
        p = logistic().fit(X[:1500], y[:1500]).predict_proba(X[1500:])[:, 1]
        self.assertGreater(classification_metrics(y[1500:], p)["auc"], 0.85)

    def test_tree_models_learn_a_real_signal(self):
        rng = np.random.default_rng(0)
        X = rng.normal(size=(3000, 3))
        y = (X[:, 0] + rng.normal(0, 0.5, 3000) > 0).astype(int)
        for make in (random_forest, gradient_boosting, xgboost):
            p = make().fit(X[:2500], y[:2500]).predict_proba(X[2500:])[:, 1]
            self.assertGreater(classification_metrics(y[2500:], p)["auc"], 0.85, make.__name__)

    def test_recurrent_model_learns_a_temporal_signal(self):
        # The label is the sign of the last 5 steps' sum (a momentum-like pattern). The last row
        # alone carries only part of it, so the GRU must use the sequence to beat a one-row model.
        rng = np.random.default_rng(0)
        X = rng.normal(size=(3000, 30, 2)).astype(np.float32)
        y = (X[:, -5:, 0].sum(axis=1) > 0).astype(int)
        dates = np.array([str(np.datetime64("2015-01-01") + i) for i in range(3000)])
        # Small batches: 2,500 rows at the default batch size would give too few gradient steps.
        model = RecurrentClassifier(cell="gru", hidden=16, batch_size=64, lr=5e-3, max_epochs=20, patience=5)
        p = model.fit(X[:2500], y[:2500], dates=dates[:2500]).predict_proba(X[2500:])[:, 1]
        last_row = logistic().fit(X[:2500, -1], y[:2500]).predict_proba(X[2500:, -1])[:, 1]
        auc, auc_last = classification_metrics(y[2500:], p)["auc"], classification_metrics(y[2500:], last_row)["auc"]
        self.assertGreater(auc, 0.9)
        self.assertGreater(auc, auc_last + 0.1)

    def test_auc_interval_contains_half_for_noise(self):
        rng = np.random.default_rng(1)
        y, p = rng.integers(0, 2, 3000), rng.uniform(size=3000)
        low, high = auc_confidence_interval(y, p, np.repeat(np.arange(30), 100))
        self.assertLess(low, 0.5)
        self.assertGreater(high, 0.5)


class SignalTests(unittest.TestCase):
    def test_mapping(self):
        self.assertEqual(to_signal(0.60, 0.3), "buy")
        self.assertEqual(to_signal(0.53, 0.3), "watch")
        self.assertEqual(to_signal(0.50, 0.3), "hold")
        self.assertEqual(to_signal(0.47, 0.3), "watch")
        self.assertEqual(to_signal(0.40, 0.3), "sell")
        self.assertEqual(to_signal(0.90, 1.2), "high_risk")

    def test_confidence(self):
        self.assertAlmostEqual(confidence(0.3), 0.7)
        self.assertAlmostEqual(confidence(0.5), 0.5)


class BacktestTests(unittest.TestCase):
    def test_hysteresis_positions(self):
        p = np.array([0.5, 0.56, 0.5, 0.48, 0.44, 0.5, 0.6])
        np.testing.assert_array_equal(positions_from_probabilities(p), [0, 1, 1, 1, 0, 0, 1])

    def test_returns_and_costs(self):
        close = np.array([100.0, 110.0, 121.0])
        flat = backtest(close, np.zeros(3), 252)
        self.assertEqual(flat["total_return"], 0.0)
        held = backtest(close, np.ones(3), 252, cost=0.0)
        self.assertAlmostEqual(held["total_return"], 0.21)
        with_cost = backtest(close, np.ones(3), 252, cost=0.01)
        self.assertAlmostEqual(with_cost["total_return"], (1.1 - 0.01) * 1.1 - 1)
        self.assertEqual(with_cost["trades"], 1)

    def test_max_drawdown(self):
        result = backtest(np.array([100.0, 50.0, 100.0]), np.ones(3), 252, cost=0.0)
        self.assertAlmostEqual(result["max_drawdown"], -0.5)


class DataTests(unittest.TestCase):
    def test_split_adjustment(self):
        rows = [{"date": f"2024-01-0{i}", "open": c, "high": c, "low": c, "close": c, "volume": 100.0}
                for i, c in enumerate([1000.0, 1010.0, 505.0, 510.0], 1)]
        adjusted, events = adjust_for_splits(rows)
        self.assertEqual(events, ["2024-01-03 1:2"])
        self.assertAlmostEqual(adjusted[0]["close"], 500.0)
        self.assertAlmostEqual(adjusted[1]["volume"], 200.0)
        self.assertAlmostEqual(adjusted[3]["close"], 510.0)

    def test_ordinary_drop_is_not_a_split(self):
        rows = [{"date": f"2024-01-0{i}", "open": c, "high": c, "low": c, "close": c, "volume": 1.0}
                for i, c in enumerate([100.0, 80.0], 1)]
        self.assertEqual(adjust_for_splits(rows)[1], [])

    def test_clean_drops_bad_rows_and_duplicates(self):
        good = {"date": "2024-01-01", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 1}
        rows = [good, dict(good), {**good, "date": "2024-01-02", "low": 0}, {**good, "date": "2024-01-03", "high": 0.5}]
        self.assertEqual(clean(rows), [good])

    def test_sequence_windows_have_no_look_ahead(self):
        features = np.arange(40, dtype=float).reshape(20, 2)
        features[:3] = np.nan  # warm-up rows
        w = sequence_windows(features, np.array([3, 10]), length=5)
        self.assertEqual(w.shape, (2, 5, 2))
        np.testing.assert_array_equal(w[1, :, 0], features[6:11, 0])  # rows 6..10, ending at the row itself
        np.testing.assert_array_equal(w[0, :, 0], np.full(5, features[3, 0]))  # padded with the first valid row

    def test_trim_stock_history(self):
        row = {"open": 1, "high": 1, "low": 1, "close": 1, "volume": 5}
        rows = [{**row, "date": "2006-12-29"}, {**row, "date": "2008-11-27", "volume": 0}, {**row, "date": "2008-11-28"}]
        self.assertEqual([r["date"] for r in trim_stock_history(rows)], ["2008-11-28"])

    def test_yahoo_rows_drop_partial_candle_and_nan(self):
        from datetime import datetime
        from finsight_ml.data import IST

        class FakeHistory:  # stands in for the pandas DataFrame yfinance returns
            def __init__(self, items):
                self.items = items

            def iterrows(self):
                return iter(self.items)

        bar = {"Open": 10.0, "High": 11.0, "Low": 9.0, "Close": 10.5, "Volume": 100.0}
        history = FakeHistory([(datetime(2026, 11, 11), bar), (datetime(2026, 11, 12), {**bar, "Close": float("nan")}),
                               (datetime(2026, 11, 13), bar)])
        during = rows_from_yahoo_history(history, now=datetime(2026, 11, 13, 11, 0, tzinfo=IST))
        after = rows_from_yahoo_history(history, now=datetime(2026, 11, 13, 16, 0, tzinfo=IST))
        self.assertEqual([r["date"] for r in during], ["2026-11-11"])
        self.assertEqual([r["date"] for r in after], ["2026-11-11", "2026-11-13"])


def simulate_garch(n, omega=0.02, alpha=0.08, beta=0.9, seed=0):
    """Daily returns (in %) from a known GARCH(1,1) process, for testing the estimator."""
    rng = np.random.default_rng(seed)
    r, var = np.zeros(n), np.full(n, omega / (1 - alpha - beta))
    for t in range(1, n):
        var[t] = omega + alpha * r[t - 1] ** 2 + beta * var[t - 1]
        r[t] = np.sqrt(var[t]) * rng.standard_normal()
    return r / 100, np.sqrt(var) / 100


class RangeTests(unittest.TestCase):
    def test_garch_recovers_known_parameters(self):
        r, _ = simulate_garch(6000)
        params = fit_garch(r)
        self.assertAlmostEqual(params["alpha"], 0.08, delta=0.03)
        self.assertAlmostEqual(params["beta"], 0.9, delta=0.04)

    def test_garch_scale_has_no_look_ahead(self):
        r, _ = simulate_garch(1000)
        params = fit_garch(r)
        changed = r.copy()
        changed[600:] *= 5  # a violent future must not change forecasts made on or before day 599
        np.testing.assert_allclose(garch_scale(r, params)[:600], garch_scale(changed, params)[:600])

    def test_interval_score_rewards_narrow_honest_ranges(self):
        y = np.array([0.0])
        self.assertAlmostEqual(interval_score(np.array([-1.0]), np.array([1.0]), y)[0], 2.0)  # width only
        self.assertAlmostEqual(interval_score(np.array([0.5]), np.array([1.0]), y)[0], 0.5 + 10 * 0.5)  # miss: width + 2/α·distance
        self.assertLess(interval_score(np.array([-0.1]), np.array([0.1]), y)[0], interval_score(np.array([-1.0]), np.array([1.0]), y)[0])

    def test_volatility_scaling_beats_constant_range(self):
        # Returns whose spread depends on a known volatility: a vol-scaled range should be calibrated
        # and score better than a constant one.
        rng = np.random.default_rng(1)
        s = np.exp(rng.normal(0, 0.6, 20000)) * 0.02
        r = s * rng.standard_normal(20000)
        X = np.zeros((20000, 1))
        const = ScaledQuantiles("one").fit(X[:15000], r[:15000], np.ones(15000))
        vol = ScaledQuantiles("vol").fit(X[:15000], r[:15000], s[:15000])
        lo_c, hi_c = const.predict(X[15000:], np.ones(5000))
        lo_v, hi_v = vol.predict(X[15000:], s[15000:])
        self.assertAlmostEqual(range_metrics(lo_v, hi_v, r[15000:])["coverage"], 0.8, delta=0.02)
        self.assertLess(interval_score(lo_v, hi_v, r[15000:]).mean(), 0.9 * interval_score(lo_c, hi_c, r[15000:]).mean())  # ≥ 10% better

    def test_quantile_trees_learn_conditional_width(self):
        # With unit scale, the trees must learn from a feature that the spread doubles when x > 0.
        rng = np.random.default_rng(2)
        x = rng.normal(size=(8000, 1))
        r = np.where(x[:, 0] > 0, 2.0, 1.0) * rng.standard_normal(8000)
        model = QuantileTrees("sklearn")
        model.scale = "one"
        model.fit(x[:6000], r[:6000], np.ones(6000))
        lo, hi = model.predict(x[6000:], np.ones(2000))
        wide, narrow = (hi - lo)[x[6000:, 0] > 0].mean(), (hi - lo)[x[6000:, 0] <= 0].mean()
        self.assertGreater(wide / narrow, 1.6)
        self.assertAlmostEqual(range_metrics(lo, hi, r[6000:])["coverage"], 0.8, delta=0.04)

    def test_earnings_window_flags(self):
        dates = np.array([f"2024-01-{d:02d}" for d in (1, 2, 3, 4, 5, 8, 9, 10, 11, 12)])
        # Results on Saturday 6 Jan: first trading day is 8 Jan (index 5). Days t = 0..5 have it
        # inside (t, t + 5], so they are flagged; later days are not.
        flags = earnings_window_flags(dates, ["2024-01-06"], horizon=5)
        np.testing.assert_array_equal(flags, [1, 1, 1, 1, 1, 1, 0, 0, 0, 0])
        # Dates outside the price history (e.g. next quarter's scheduled date) are ignored here.
        np.testing.assert_array_equal(earnings_window_flags(dates, ["2025-01-01"], horizon=5), np.zeros(10))

    def test_earnings_model_widens_ranges_only_in_results_weeks(self):
        rng = np.random.default_rng(4)
        flag = (rng.random(20000) < 0.1).astype(float)
        r = np.where(flag > 0, 2.4, 1.0) * rng.standard_normal(20000) * 0.03
        X = np.column_stack([np.zeros(20000), flag])
        model = EarningsScaledQuantiles("one").fit(X[:15000], r[:15000], np.ones(15000))
        lo, hi = model.predict(X[15000:], np.ones(5000))
        width = hi - lo
        self.assertGreater(width[flag[15000:] > 0].mean() / width[flag[15000:] == 0].mean(), 2.0)
        for group in (True, False):
            rows = (flag[15000:] > 0) == group
            self.assertAlmostEqual(range_metrics(lo[rows], hi[rows], r[15000:][rows])["coverage"], 0.8, delta=0.04)

    def test_earnings_model_without_earnings_equals_plain_model(self):
        rng = np.random.default_rng(5)
        r, X = rng.standard_normal(2000), np.zeros((2000, 2))  # flag column all zero, as for crypto
        plain = ScaledQuantiles("one").fit(X, r, np.ones(2000)).predict(X, np.ones(2000))
        earn = EarningsScaledQuantiles("one").fit(X, r, np.ones(2000)).predict(X, np.ones(2000))
        np.testing.assert_allclose(plain, earn)

    def test_skill_interval_is_zero_for_identical_models(self):
        score = np.random.default_rng(3).random(500)
        point, ci = skill_interval(score, score, np.repeat(np.arange(10), 50))
        self.assertEqual(point, 0.0)
        self.assertEqual(ci, [0.0, 0.0])


if __name__ == "__main__":
    unittest.main()
