"""Recurrent sequence models (LSTM, GRU) built with PyTorch.

Unlike the tabular models, which see one day's 19 indicators, these read the last SEQ_LEN days
of indicators for the same asset (shape: rows × SEQ_LEN × 19) and can, in principle, learn
temporal patterns the indicators don't summarise. They plug into the same walk-forward
evaluation through the fit / predict_proba interface; `sequence = True` tells the pipeline to
pass windows instead of rows.
"""

import numpy as np
import torch
from torch import nn

from .config import RANDOM_STATE

SEQ_LEN = 30  # trading days of history per sample (~6 weeks)


def sequence_windows(features: np.ndarray, rows: np.ndarray, length: int = SEQ_LEN) -> np.ndarray:
    """For each index in `rows`, the feature rows [i - length + 1, i] of one asset, oldest first.

    Uses only rows up to and including i (no look-ahead). Feature rows before the first fully
    defined one (warm-up) are never used: the window is padded by repeating that first row.
    """
    first = int(np.flatnonzero(~np.isnan(features).any(axis=1))[0])
    offsets = np.arange(-length + 1, 1)
    idx = np.maximum(rows[:, None] + offsets[None, :], first)
    return features[idx].astype(np.float32)


class _Net(nn.Module):
    def __init__(self, cell: str, n_features: int, hidden: int, dropout: float):
        super().__init__()
        rnn = nn.LSTM if cell == "lstm" else nn.GRU
        self.rnn = rnn(n_features, hidden, batch_first=True)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(hidden, 1))

    def forward(self, x):
        out, _ = self.rnn(x)
        return self.head(out[:, -1]).squeeze(-1)  # logit from the last time step


class RecurrentClassifier:
    """Small, heavily regularised recurrent classifier for P(up).

    Daily returns are mostly noise, so capacity is kept low (one layer, 16 units), with dropout,
    weight decay and early stopping. The early-stopping set is the most recent 15% of the
    training dates (a time-ordered split; a random split would validate on the past using the future).
    """

    sequence = True

    def __init__(self, cell="lstm", hidden=16, dropout=0.2, lr=2e-3, weight_decay=1e-3,
                 batch_size=512, max_epochs=20, patience=3, val_fraction=0.15):
        self.cell, self.hidden, self.dropout, self.lr, self.weight_decay = cell, hidden, dropout, lr, weight_decay
        self.batch_size, self.max_epochs, self.patience, self.val_fraction = batch_size, max_epochs, patience, val_fraction

    def _scale(self, X):
        return torch.from_numpy(((X - self.mean) / self.std).astype(np.float32))

    def fit(self, X, y, dates=None):
        torch.manual_seed(RANDOM_STATE)
        rng = np.random.default_rng(RANDOM_STATE)
        # Standardise each feature with training statistics only.
        flat = X.reshape(-1, X.shape[-1])
        self.mean, self.std = flat.mean(axis=0), flat.std(axis=0) + 1e-8

        if dates is not None:
            cutoff = np.quantile(np.unique(dates).astype("datetime64[D]").astype(np.int64), 1 - self.val_fraction)
            is_val = dates.astype("datetime64[D]").astype(np.int64) >= cutoff
        else:
            is_val = np.zeros(len(y), bool)
            is_val[int(len(y) * (1 - self.val_fraction)):] = True
        Xt, yt = self._scale(X[~is_val]), torch.from_numpy(y[~is_val].astype(np.float32))
        Xv, yv = self._scale(X[is_val]), torch.from_numpy(y[is_val].astype(np.float32))

        self.net = _Net(self.cell, X.shape[-1], self.hidden, self.dropout)
        optimiser = torch.optim.AdamW(self.net.parameters(), lr=self.lr, weight_decay=self.weight_decay)
        loss_fn = nn.BCEWithLogitsLoss()
        best_loss, best_state, stale = np.inf, None, 0
        for _ in range(self.max_epochs):
            self.net.train()
            for batch in np.array_split(rng.permutation(len(yt)), max(1, len(yt) // self.batch_size)):
                optimiser.zero_grad()
                loss_fn(self.net(Xt[batch]), yt[batch]).backward()
                optimiser.step()
            self.net.eval()
            with torch.no_grad():
                val_loss = loss_fn(self.net(Xv), yv).item() if len(yv) else 0.0
            if val_loss < best_loss - 1e-4:
                best_loss, stale = val_loss, 0
                best_state = {k: v.clone() for k, v in self.net.state_dict().items()}
            else:
                stale += 1
                if stale >= self.patience:
                    break
        if best_state is not None:
            self.net.load_state_dict(best_state)
        self.net.eval()
        return self

    def predict_proba(self, X):
        with torch.no_grad():
            p = torch.sigmoid(self.net(self._scale(X))).numpy().astype(float)
        return np.column_stack([1 - p, p])
