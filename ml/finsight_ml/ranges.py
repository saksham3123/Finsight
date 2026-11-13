"""Range forecasts: an 80% interval for the close in HORIZON trading days.

Direction is close to unpredictable (see EVALUATION.md), but the *size* of moves is not:
volatility clusters, so calm weeks tend to follow calm weeks. Each model here predicts the
10th and 90th percentiles of the 5-day log return r = log(close[t+5] / close[t]); the price
range is close[t] · exp(quantile).

Every model works on a "scale" s (a 5-day volatility estimate known at day t) and learns the
quantiles of the standardised return z = r / s, then predicts q(z) · s:

  constant    s = 1: the same range every day (naive baseline, the analogue of "always up")
  hist_vol    s = 20-day volatility · √5, with quantiles of z fitted on training data
  garch       s = GARCH(1,1) 5-day volatility, fitted per asset (scipy maximum likelihood)
  gbm, xgb    quantile regression on the 19 indicators, s = hist-vol scale
  lstm        quantile LSTM over 30-day indicator windows, s = hist-vol scale

"*_earn" variants (stocks) also know whether a results announcement falls inside the 5-day
window. Earnings models receive X with that 0/1 flag appended as the last column.

Scaling lets one pooled model serve both calm large caps and volatile coins: the ML models
only have to learn how today's conditions shift the standardised quantiles.
"""

import numpy as np
import torch
from scipy.optimize import minimize
from scipy.signal import lfilter
from scipy.special import xlogy
from scipy.stats import chi2
from sklearn.ensemble import HistGradientBoostingRegressor
from torch import nn
from xgboost import XGBRegressor

from .config import HORIZON, RANDOM_STATE, RANGE_LEVEL
from .features import FEATURE_NAMES

LEVEL = RANGE_LEVEL
ALPHA = round(1 - LEVEL, 10)
QUANTILES = (round(ALPHA / 2, 10), round(1 - ALPHA / 2, 10))  # central interval: (0.1, 0.9) at the default 80% level
VOL20 = FEATURE_NAMES.index("vol_20")


# --------------------------------------------------------------------------- GARCH(1,1)

def _garch_variance(r, omega, alpha, beta, initial):
    """σ²_t = ω + α·r²_{t−1} + β·σ²_{t−1}, computed as a linear filter (fast, no Python loop)."""
    x = omega + alpha * np.concatenate([[initial], r[:-1] ** 2])
    return lfilter([1.0], [1.0, -beta], x, zi=[beta * initial])[0]


def fit_garch(returns: np.ndarray) -> dict:
    """Maximum-likelihood GARCH(1,1) with zero mean and normal errors.

    Returns are scaled ×100 for numerical stability. Constraints: ω > 0, α, β ≥ 0 and
    α + β < 1 (stationary, so long-run variance ω / (1 − α − β) exists).
    """
    r = returns[np.isfinite(returns)] * 100
    initial = float(np.var(r))

    def nll(params):
        omega, alpha, beta = params
        if alpha + beta >= 0.999:
            return 1e12
        var = _garch_variance(r, omega, alpha, beta, initial)
        if np.any(var <= 0):
            return 1e12
        return 0.5 * np.sum(np.log(var) + r ** 2 / var)

    start = np.array([initial * 0.05, 0.08, 0.9])
    bounds = [(1e-6, 10 * initial), (0.0, 0.5), (0.0, 0.999)]
    res = minimize(nll, start, method="L-BFGS-B", bounds=bounds)
    omega, alpha, beta = res.x
    return {"omega": float(omega), "alpha": float(alpha), "beta": float(beta), "initial": initial}


def garch_scale(returns: np.ndarray, params: dict, horizon: int = HORIZON) -> np.ndarray:
    """5-day return volatility forecast for every day t, using returns up to and including t.

    One-step variance σ²_{t+1} = ω + α·r_t² + β·σ²_t; h-step forecasts decay towards the long-run
    variance V_L: σ²_{t+h} = V_L + (α+β)^(h−1) · (σ²_{t+1} − V_L). The 5-day variance is their sum.
    """
    r = np.nan_to_num(returns) * 100
    omega, alpha, beta, initial = params["omega"], params["alpha"], params["beta"], params["initial"]
    var_t = _garch_variance(r, omega, alpha, beta, initial)
    next_var = omega + alpha * r ** 2 + beta * var_t
    persistence = alpha + beta
    long_run = omega / (1 - persistence)
    total = sum(long_run + persistence ** (h - 1) * (next_var - long_run) for h in range(1, horizon + 1))
    return np.sqrt(total) / 100


# --------------------------------------------------------------------------- models

def hist_vol_scale(X: np.ndarray) -> np.ndarray:
    """20-day daily volatility scaled to 5 days (√5 rule). Works on rows or on sequence windows."""
    vol = X[:, -1, VOL20] if X.ndim == 3 else X[:, VOL20]
    return np.maximum(vol, 1e-4) * np.sqrt(HORIZON)


class ScaledQuantiles:
    """Empirical quantiles of z = r / s from training data. With scale "one" this is the
    constant-range baseline; with "vol" or "garch" it is a calibrated volatility model."""

    def __init__(self, scale: str):
        self.scale = scale

    def fit(self, X, r, s):
        self.q = np.quantile(r / s, QUANTILES)
        return self

    def predict(self, X, s):
        return self.q[0] * s, self.q[1] * s


class EarningsScaledQuantiles(ScaledQuantiles):
    """Like ScaledQuantiles, but with separate quantiles of z for windows that contain a results
    announcement and windows that don't (earnings weeks move about 2.4× more). Falls back to the
    pooled quantiles if a group has fewer than MIN_ROWS training rows (e.g. crypto: no earnings)."""

    earnings = True
    MIN_ROWS = 200

    def fit(self, X, r, s):
        z, flag = r / s, X[:, -1] > 0.5
        pooled = np.quantile(z, QUANTILES)
        self.q = {g: np.quantile(z[flag == g], QUANTILES) if np.sum(flag == g) >= self.MIN_ROWS else pooled
                  for g in (False, True)}
        return self

    def predict(self, X, s):
        flag = X[:, -1] > 0.5
        lo = np.where(flag, self.q[True][0], self.q[False][0]) * s
        hi = np.where(flag, self.q[True][1], self.q[False][1]) * s
        return lo, hi


class QuantileTrees:
    """Gradient-boosted quantile regression of z = r / s on the indicators (sklearn or XGBoost)."""

    scale = "vol"

    def __init__(self, library: str):
        self.library = library

    def _make(self, q):
        if self.library == "xgb":
            return XGBRegressor(objective="reg:quantileerror", quantile_alpha=q, n_estimators=300, max_depth=3,
                                learning_rate=0.03, subsample=0.8, colsample_bytree=0.8, min_child_weight=200,
                                tree_method="hist", n_jobs=-1, random_state=RANDOM_STATE)
        return HistGradientBoostingRegressor(loss="quantile", quantile=q, max_depth=3, learning_rate=0.03, max_iter=200,
                                             min_samples_leaf=200, l2_regularization=1.0, early_stopping=False,
                                             random_state=RANDOM_STATE)

    def fit(self, X, r, s):
        z = r / s
        self.models = [self._make(q).fit(X, z) for q in QUANTILES]
        return self

    def predict(self, X, s):
        lo, hi = (m.predict(X) * s for m in self.models)
        return np.minimum(lo, hi), np.maximum(lo, hi)  # quantile models can cross; keep lo ≤ hi


class EarningsQuantileTrees(QuantileTrees):
    """QuantileTrees with the earnings flag as an extra input column."""

    earnings = True


def pinball(z_pred, z_true, q):
    diff = z_true - z_pred
    return torch.mean(torch.maximum(q * diff, (q - 1) * diff))


class _QuantileNet(nn.Module):
    def __init__(self, n_features, hidden=16, dropout=0.2):
        super().__init__()
        self.rnn = nn.LSTM(n_features, hidden, batch_first=True)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(hidden, len(QUANTILES)))

    def forward(self, x):
        out, _ = self.rnn(x)
        return self.head(out[:, -1])


class QuantileLSTM:
    """LSTM over 30-day indicator windows predicting the 10th and 90th percentiles of z with the
    pinball (quantile) loss. Same size, regularisation and time-ordered early stopping as the
    direction LSTM in sequence.py."""

    scale = "vol"
    sequence = True

    def __init__(self, hidden=16, lr=2e-3, weight_decay=1e-3, batch_size=512, max_epochs=20, patience=3, val_fraction=0.15):
        self.hidden, self.lr, self.weight_decay = hidden, lr, weight_decay
        self.batch_size, self.max_epochs, self.patience, self.val_fraction = batch_size, max_epochs, patience, val_fraction

    def _x(self, X):
        return torch.from_numpy(((X - self.mean) / self.std).astype(np.float32))

    def _loss(self, out, z):
        return sum(pinball(out[:, i], z, q) for i, q in enumerate(QUANTILES))

    def fit(self, X, r, s, dates=None):
        torch.manual_seed(RANDOM_STATE)
        rng = np.random.default_rng(RANDOM_STATE)
        flat = X.reshape(-1, X.shape[-1])
        self.mean, self.std = flat.mean(axis=0), flat.std(axis=0) + 1e-8
        z = (r / s).astype(np.float32)
        day = dates.astype("datetime64[D]").astype(np.int64)
        is_val = day >= np.quantile(np.unique(day), 1 - self.val_fraction)
        Xt, zt, Xv, zv = self._x(X[~is_val]), torch.from_numpy(z[~is_val]), self._x(X[is_val]), torch.from_numpy(z[is_val])

        self.net = _QuantileNet(X.shape[-1], self.hidden)
        optimiser = torch.optim.AdamW(self.net.parameters(), lr=self.lr, weight_decay=self.weight_decay)
        best, best_state, stale = np.inf, None, 0
        for _ in range(self.max_epochs):
            self.net.train()
            for batch in np.array_split(rng.permutation(len(zt)), max(1, len(zt) // self.batch_size)):
                optimiser.zero_grad()
                self._loss(self.net(Xt[batch]), zt[batch]).backward()
                optimiser.step()
            self.net.eval()
            with torch.no_grad():
                val = self._loss(self.net(Xv), zv).item()
            if val < best - 1e-5:
                best, stale, best_state = val, 0, {k: v.clone() for k, v in self.net.state_dict().items()}
            else:
                stale += 1
                if stale >= self.patience:
                    break
        if best_state is not None:
            self.net.load_state_dict(best_state)
        self.net.eval()
        return self

    def predict(self, X, s):
        with torch.no_grad():
            out = self.net(self._x(X)).numpy().astype(float)
        lo, hi = out[:, 0] * s, out[:, 1] * s
        return np.minimum(lo, hi), np.maximum(lo, hi)


RANGE_MODELS = {
    "constant": lambda: ScaledQuantiles("one"),
    "hist_vol": lambda: ScaledQuantiles("vol"),
    "garch": lambda: ScaledQuantiles("garch"),
    "gbm_quantile": lambda: QuantileTrees("sklearn"),
    "xgb_quantile": lambda: QuantileTrees("xgb"),
    "lstm_quantile": QuantileLSTM,
    "hist_vol_earn": lambda: EarningsScaledQuantiles("vol"),
    "garch_earn": lambda: EarningsScaledQuantiles("garch"),
    "gbm_quantile_earn": lambda: EarningsQuantileTrees("sklearn"),
    "xgb_quantile_earn": lambda: EarningsQuantileTrees("xgb"),
}
# Each earnings model and the same model without earnings, for the head-to-head comparison.
EARNINGS_BASE = {"hist_vol_earn": "hist_vol", "garch_earn": "garch", "gbm_quantile_earn": "gbm_quantile",
                 "xgb_quantile_earn": "xgb_quantile"}
RANGE_BASELINE = "constant"
RANGE_LABELS = {
    "constant": "Constant range (baseline)", "hist_vol": "Historical volatility (20-day)", "garch": "GARCH(1,1)",
    "gbm_quantile": "Quantile gradient boosting", "xgb_quantile": "Quantile XGBoost", "lstm_quantile": "Quantile LSTM",
    "hist_vol_earn": "Historical volatility + earnings", "garch_earn": "GARCH(1,1) + earnings",
    "gbm_quantile_earn": "Quantile gradient boosting + earnings", "xgb_quantile_earn": "Quantile XGBoost + earnings",
}


# --------------------------------------------------------------------------- metrics

def interval_score(lo, hi, y, alpha=ALPHA):
    """Winkler interval score per row (lower is better): width plus 2/α times any miss distance.
    A proper scoring rule for central (1−α) intervals: it can't be gamed by making ranges wider
    or narrower than the forecaster believes."""
    return (hi - lo) + (2 / alpha) * np.maximum(lo - y, 0) + (2 / alpha) * np.maximum(y - hi, 0)


def range_metrics(lo, hi, y):
    """Metrics on the log-return scale; widths are also reported as % of price."""
    inside = (y >= lo) & (y <= hi)
    return {
        "rows": int(len(y)),
        "coverage": float(np.mean(inside)),
        "below": float(np.mean(y < lo)),
        "above": float(np.mean(y > hi)),
        "mean_width_pct": float(np.mean(np.exp(hi) - np.exp(lo)) * 100),
        "interval_score": float(np.mean(interval_score(lo, hi, y))),
    }


def kupiec_test(miss: np.ndarray, level: float = LEVEL) -> dict:
    """Kupiec's unconditional-coverage test: is the share of misses consistent with 1 − level?
    Likelihood ratio against the observed miss rate, χ²(1). A small p-value rejects calibration."""
    n, x = len(miss), int(np.sum(miss))
    p, rate = 1 - level, x / n
    lr = -2 * ((xlogy(n - x, 1 - p) + xlogy(x, p)) - (xlogy(n - x, 1 - rate) + xlogy(x, rate)))
    return {"n": n, "misses": x, "coverage": 1 - rate, "lr_uc": float(lr), "p_uc": float(chi2.sf(lr, 1))}


def christoffersen_test(miss: np.ndarray, level: float = LEVEL) -> dict:
    """Christoffersen's tests on a time-ordered miss sequence. Independence: a miss should be no
    more likely after a miss than after a hit (first-order Markov alternative, χ²(1)). Conditional
    coverage adds Kupiec's statistic (χ²(2)): the right number of misses, and not in clusters."""
    result = kupiec_test(miss, level)
    m = np.asarray(miss, dtype=bool)
    prev, cur = m[:-1], m[1:]
    n00, n01 = np.sum(~prev & ~cur), np.sum(~prev & cur)
    n10, n11 = np.sum(prev & ~cur), np.sum(prev & cur)
    pi01, pi11 = n01 / max(n00 + n01, 1), n11 / max(n10 + n11, 1)
    pi = (n01 + n11) / max(len(cur), 1)
    pooled = xlogy(n00 + n10, 1 - pi) + xlogy(n01 + n11, pi)
    markov = xlogy(n00, 1 - pi01) + xlogy(n01, pi01) + xlogy(n10, 1 - pi11) + xlogy(n11, pi11)
    lr_ind = max(float(-2 * (pooled - markov)), 0.0)
    result.update({"lr_ind": lr_ind, "p_ind": float(chi2.sf(lr_ind, 1)),
                   "lr_cc": result["lr_uc"] + lr_ind, "p_cc": float(chi2.sf(result["lr_uc"] + lr_ind, 2))})
    return result


def skill_interval(score_model, score_base, fold_ids, n_boot=500, seed=0):
    """Skill = 1 − mean(score_model) / mean(score_base), with a 95% block-bootstrap interval that
    resamples whole test windows (neighbouring days share overlapping 5-day outcomes)."""
    rng = np.random.default_rng(seed)
    folds = np.unique(fold_ids)
    by_fold = [(score_model[fold_ids == f].sum(), score_base[fold_ids == f].sum()) for f in folds]
    sums = np.array(by_fold)
    point = 1 - sums[:, 0].sum() / sums[:, 1].sum()
    draws = []
    for _ in range(n_boot):
        pick = sums[rng.integers(0, len(sums), len(sums))]
        draws.append(1 - pick[:, 0].sum() / pick[:, 1].sum())
    return float(point), [float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))]
