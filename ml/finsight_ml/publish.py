"""Pushes real prices and model advisories to the FinSight backend using the ML service key."""

import requests

from . import config
from .data import DataError, load_series

TIMEOUT = 60


def _headers():
    if not config.ML_SERVICE_KEY:
        raise DataError("ML_SERVICE_KEY is not set in ml/.env (copy it from backend/.env)")
    return {"X-Service-Key": config.ML_SERVICE_KEY, "Content-Type": "application/json"}


def _request(method, path, **kwargs):
    try:
        response = requests.request(method, f"{config.FINSIGHT_API_URL}{path}", timeout=TIMEOUT, **kwargs)
    except requests.ConnectionError as error:
        raise DataError(f"Cannot reach the backend at {config.FINSIGHT_API_URL} — is `npm run dev` running?") from error
    if response.status_code >= 400:
        raise DataError(f"{method} {path} → {response.status_code}: {response.text[:300]}")
    return response.json() if response.content else None


def asset_ids() -> dict:
    assets = _request("GET", "/assets", params={"limit": 200})["assets"]
    return {(a["symbol"], a["assetType"]): a["id"] for a in assets}


def publish_prices(log=print) -> int:
    """Replaces each asset's stored candles with the real history (removing any synthetic demo prices)."""
    ids, total = asset_ids(), 0
    for symbol, asset_type in config.ASSETS:
        if (symbol, asset_type) not in ids:
            log(f"  {symbol}: not in backend; skipped")
            continue
        try:
            series = load_series(symbol, asset_type)
        except DataError:
            continue
        candles = [
            {"date": str(d), "open": f"{o:.8f}", "high": f"{h:.8f}", "low": f"{l:.8f}", "close": f"{c:.8f}", "volume": f"{v:.8f}"}
            for d, o, h, l, c, v in zip(series["date"], series["open"], series["high"], series["low"], series["close"], series["volume"])
        ]
        asset_id = ids[(symbol, asset_type)]
        for i in range(0, len(candles), 5000):
            chunk = candles[i:i + 5000]
            # Only the first chunk replaces; later chunks add to it.
            body = {"candles": chunk, "replace": i == 0}
            total += _request("PUT", f"/assets/{asset_id}/prices", headers=_headers(), json=body)["upserted"]
        log(f"  {symbol:<11} {len(candles)} candles")
    return total


def publish_advisories(advisories: list[dict]) -> int:
    fields = ("symbol", "assetType", "date", "signal", "confidence", "riskScore", "rationale", "modelVersion",
              "priceLow", "priceHigh", "rangeLevel", "horizonDays", "rangeModelVersion")
    # Range fields are present only when a range model is trained; the backend accepts all four or none.
    payload = [{key: a[key] for key in fields if key in a} for a in advisories]
    return _request("POST", "/advisories", headers=_headers(), json={"advisories": payload})["upserted"]
