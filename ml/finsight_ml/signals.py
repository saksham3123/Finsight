"""Turns a model probability into the advisory signal the backend stores."""

from . import config


def to_signal(p_up: float, annual_volatility: float) -> str:
    """
    high_risk  volatility at or above the risk cut-off (overrides the model)
    buy        P(up in 5 days) >= BUY_THRESHOLD
    sell       P(up) <= SELL_THRESHOLD
    watch      leaning one way, but within WATCH_MARGIN of a threshold
    hold       no clear edge — keep the current position
    """
    if annual_volatility >= config.HIGH_RISK_VOLATILITY:
        return "high_risk"
    if p_up >= config.BUY_THRESHOLD:
        return "buy"
    if p_up <= config.SELL_THRESHOLD:
        return "sell"
    if p_up >= config.BUY_THRESHOLD - config.WATCH_MARGIN or p_up <= config.SELL_THRESHOLD + config.WATCH_MARGIN:
        return "watch"
    return "hold"


def confidence(p_up: float) -> float:
    """Probability the model assigns to the direction it predicts (0.5 = coin flip)."""
    return max(p_up, 1 - p_up)
