"""Candidate models and baselines. Every model maps a feature matrix to P(price higher in 5 days).

A new model only needs a factory returning an object with fit(X, y) and predict_proba(X).
Models with `sequence = True` (LSTM, GRU in sequence.py) receive 30-day windows of features
instead of single rows, plus the row dates for a time-ordered early-stopping split.
"""

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from .config import RANDOM_STATE
from .features import FEATURE_NAMES
from .sequence import RecurrentClassifier


class AlwaysUp:
    """Baseline: predicts the share of 'up' outcomes seen in training for every row.
    Markets drift upward, so this already scores above 50% accuracy; a model must beat it."""

    def fit(self, X, y):
        self.p = float(np.mean(y))
        return self

    def predict_proba(self, X):
        return np.column_stack([np.full(len(X), 1 - self.p), np.full(len(X), self.p)])


class SmaTrend:
    """Baseline: classic trend rule — up if the 20-day SMA is above the 50-day SMA.
    Mirrors the direction logic of the backend's rule-based baseline-sma-v1 advisories."""

    column = FEATURE_NAMES.index("sma20_sma50")

    def fit(self, X, y):
        return self

    def predict_proba(self, X):
        p = np.where(X[:, self.column] > 0, 0.6, 0.4)
        return np.column_stack([1 - p, p])


def logistic():
    # Strong L2 regularisation (C=0.05): daily-return features are noisy and highly correlated.
    return make_pipeline(StandardScaler(), LogisticRegression(C=0.05, max_iter=2000))


def mlp():
    # Small network with weight decay and early stopping to limit over-fitting to noise.
    return make_pipeline(
        StandardScaler(),
        MLPClassifier(hidden_layer_sizes=(32, 16), alpha=1e-2, learning_rate_init=1e-3, max_iter=300,
                      early_stopping=True, validation_fraction=0.15, n_iter_no_change=15, random_state=RANDOM_STATE),
    )


def random_forest():
    # Shallow trees with large leaves: each leaf averages >= 200 days, so it can't memorise noise.
    return RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=200, max_features="sqrt",
                                  n_jobs=-1, random_state=RANDOM_STATE)


def gradient_boosting():
    # Few shallow trees and a small learning rate; boosting over-fits noisy targets quickly.
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.03, max_iter=150, min_samples_leaf=200,
                                          l2_regularization=1.0, early_stopping=False, random_state=RANDOM_STATE)


def xgboost():
    # Same idea as gradient_boosting, with XGBoost's row/column subsampling for extra regularisation.
    # min_child_weight is a sum of hessians p(1-p) ≈ 0.25 per row, so 50 ≈ 200 rows per leaf.
    return XGBClassifier(n_estimators=300, max_depth=3, learning_rate=0.03, subsample=0.8, colsample_bytree=0.8,
                         min_child_weight=50, reg_lambda=1.0, tree_method="hist", n_jobs=-1, random_state=RANDOM_STATE,
                         eval_metric="logloss")


def lstm():
    return RecurrentClassifier(cell="lstm")


def gru():
    return RecurrentClassifier(cell="gru")


CANDIDATES = {"logistic": logistic, "mlp": mlp, "random_forest": random_forest, "gradient_boosting": gradient_boosting,
              "xgboost": xgboost,
              "lstm": lstm, "gru": gru}
BASELINES = {"always_up": AlwaysUp, "sma_trend": SmaTrend}
ALL_MODELS = {**BASELINES, **CANDIDATES}
