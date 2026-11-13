# FinSight ML — Design Decisions

## M1. Problem framing

### M1-1. Predict 5-day direction, not tomorrow's price
- **Target:** `1` if the close in 5 trading days is higher than today's close, else `0` (binary classification).
- **Why direction instead of price:** an exact price forecast is mostly noise, while the app needs a decision (buy/hold/sell) plus a confidence, and a probability of "up" gives exactly that.
- **Why 5 days:** next-day direction is the noisiest target, close to a coin flip. 20 days gives far fewer independent samples to test on. 5 days (one trading week) is a common middle ground and matches a retail investor's horizon.
- **Rejected:** price regression and next-day direction (both were offered; the user chose 5-day direction).

### M1-2. Honest expectations are part of the design
- The Efficient Market Hypothesis says public price data should carry little predictive information, especially for heavily traded large caps and major cryptocurrencies. The pipeline is therefore built to **measure** whether there is an edge, not to assume one. Every model is compared with naive baselines, uncertainty is reported, and the report says "no reliable edge" when that's the result.

## M2. Data

### M2-1. Sources
| Asset type | Source | Why |
|---|---|---|
| NSE stocks | Yahoo Finance via the `yfinance` library, NSE tickers (`RELIANCE.NS`), from 2007-01-01 | Free full daily history, already split-adjusted. Chosen by the user after Alpha Vantage moved `outputsize=full` to its paid plan (the free tier only returns the last 100 days, too short for walk-forward testing). |
| Crypto | Binance public `/api/v3/klines`, USDT pairs | Free, no key, full daily history since 2017. USDT is pegged to USD, matching the backend's USD crypto currency. |

- **Rejected:** hand-written scripted Yahoo downloads that imitate a browser (bot-check circumvention). `yfinance` is an unofficial but widely used open-source library; its terms-of-use risk is noted as a limitation, and the code is isolated in `fetch_yahoo()` so the source can be swapped.
- **Superseded:** Alpha Vantage (first choice). The split-adjustment code written for it (`adjust_for_splits`) is kept and tested, but no longer applied, because Yahoo's OHLC is already split-adjusted.
- Data is cached in `data/raw/*.csv` and re-downloaded at most once a day. Requests are spaced 1.5 s apart, and the fetcher stops if Yahoo reports rate limiting.

### M2-2. Cleaning
- Duplicate dates and rows with non-positive or inconsistent prices (high < low) are dropped.
- **Crypto:** Binance's current-day candle is still forming, so only candles whose close time has passed are kept. Otherwise today's half-finished candle would be treated as a real close.
- **Stock splits:** Alpha Vantage's free series is **not split-adjusted** (the adjusted endpoint is a paid feature), so a 1:1 bonus issue would look like a 50% crash and corrupt every feature around it. An overnight gap whose open/previous-close ratio is within 3% of 1/2, 1/3, 1/4, 1/5 or 1/10 is treated as a split, and all earlier prices are divided by the factor (volume multiplied). A real 20% fall is not mistaken for a split, which a unit test checks.
- **Stock history starts on 2007-01-01.** A scan of Yahoo's NSE data for one-day moves above 25% found bad ticks before 2007 (RELIANCE ×4.4 on 2005-07-28 then ×0.23 the next day, LT ×0.49/×1.95 in 2006) and TCS rows from 2002, two years before its 2004 listing. After 2007, every move above 20% matches a real event (2008 crash, the 2009-05-18 election-result rally, SBI's 2017-10-25 recapitalisation jump). That still leaves ~4,890 days per stock.
- **Zero-volume rows are dropped for stocks.** Yahoo fills exchange closures (e.g. 2008-11-27 during the Mumbai attacks, election holidays) with flat candles that never traded, which would distort the volume z-score.
- **Partial candle:** while NSE is open (before 15:30 IST), today's Yahoo row is still forming and is dropped, mirroring the Binance rule.
- **Limitation:** prices are not dividend-adjusted (`auto_adjust=False`), so a dividend looks like a small drop on the ex-date. For these large caps dividend yields are ~1–3% a year, so the effect on 5-day direction is small.

### M2-3. No pandas
- *Update:* yfinance needs pandas, and pandas 2.3.3 now loads on this machine. The pipeline itself still uses only numpy, so pandas stays confined to the download step.
- pandas' compiled modules were blocked on the development machine by **Windows Smart App Control** (`DLL load failed ... An Application Control policy has blocked this file`), the same policy that blocked PostgreSQL's PL/pgSQL. Series are dicts of numpy arrays and CSV goes through Python's `csv` module.
- Turning Smart App Control off was **not** recommended: it can't be turned back on without reinstalling Windows.

## M3. Features

### M3-1. 19 scale-free technical indicators
| Group | Features |
|---|---|
| Momentum | log returns over 1, 5, 10, 20 days; RSI-14 (Wilder); MACD histogram ÷ price |
| Trend | close ÷ SMA10/20/50/200 − 1; SMA20 ÷ SMA50 − 1; position in the 52-week range |
| Volatility | std of daily returns over 10 and 20 days, and their ratio; ATR-14 ÷ price; today's high–low range ÷ price; Bollinger %B |
| Volume | z-score of log volume over 20 days |

- **Scale-free** (ratios, returns, z-scores) so one model can learn from many assets: a ₹400 stock and a $70,000 coin produce comparable numbers.
- A 252-day warm-up is discarded so every feature, including the 52-week range and the EMA-based MACD, is fully formed.

### M3-2. No look-ahead
- Every feature at day *t* uses prices up to *t* only. This is **tested**: the test multiplies all prices after day *t* by 3 and asserts that no feature at or before *t* changes. Look-ahead bias is the most common reason published trading models look better than they are.

## M4. Models

### M4-1. Pooled model per asset type
- One model for all stocks and one for all cryptos, trained on rows from every asset of that type. This gives about 14,000 crypto rows instead of about 3,000 per coin, which reduces over-fitting. Stocks and crypto are kept separate because their volatility and trading calendars differ (252 vs 365 days a year).

### M4-2. Candidates
- **Logistic regression** with strong L2 regularisation (C = 0.05), after standardising features. It's interpretable and hard to over-fit, which suits noisy data.
- **MLP neural network** (32→16 hidden units, weight decay 0.01, early stopping on a 15% validation split). It can capture non-linear interactions, such as "oversold *and* low volatility".
- **Random forest** (300 trees, max depth 6, ≥ 200 rows per leaf), **XGBoost** (300 trees, depth 3, learning rate 0.03, 80% row and column subsampling, `min_child_weight` 50 ≈ 200 rows per leaf) and **gradient boosting** (scikit-learn `HistGradientBoosting`, depth 3, learning rate 0.03, 150 trees, L2 = 1). These are the usual strong models for tabular indicator data. Large leaves and shallow trees stop them memorising noise: each leaf averages at least 200 days.
- **LSTM and GRU** (PyTorch, one recurrent layer of 16 units, dropout 0.2, AdamW weight decay 1e-3, up to 20 epochs). See M4-4.
- Adding a model only needs a function returning an object with `fit` and `predict_proba`.
- *History:* tree models and PyTorch were first left out because Windows Smart App Control blocked their compiled DLLs (M2-3). The user turned Smart App Control off on 2026-11-13, and all four were then added.

### M4-4. Recurrent models (LSTM, GRU)
- **Why:** examiners and the literature commonly use recurrent networks for financial time series. The tabular models see only today's 19 indicators, while a recurrent model reads a **30-day window** of them and could, in principle, learn temporal patterns the indicators don't summarise. Testing them turns "why not an LSTM?" into evidence.
- **Same rows, same folds.** Each dataset row also gets its 30-day window, built from the same asset only and ending at that row (`sequence_windows`, covered by a no-look-ahead test). All six candidates are scored on identical rows and walk-forward folds, so the comparison is fair. The first rows of each asset are padded by repeating the first valid feature row; they always fall in the training data.
- **Input = the 19 standardised indicators**, not raw prices. Raw price levels aren't comparable across assets, and the indicators already include 1-day returns, so the network can still see the return path.
- **Small and regularised on purpose.** Daily returns are mostly noise, and a larger network would fit that noise. 16 units, dropout, weight decay and early stopping (patience 3) keep capacity low.
- **Time-ordered early stopping.** The validation set is the most recent 15% of each training window's dates, never a random sample. A random split would validate on the past using the future.
- **Unit test:** the GRU must learn a planted momentum pattern (sign of the last 5 steps' sum) with AUC > 0.9 and beat a one-row logistic model by at least 0.1 AUC, which proves it uses the sequence.
- **Cost:** about 30–65 s per fit on CPU at full size. A full evaluation (66 stock folds, 42 crypto folds, six candidates) takes about 1–1.5 hours.

### M4-3. Baselines a model must beat
- **Always up:** predicts the training share of "up" windows. Markets drift upward, so this already beats 50% in rising periods.
- **SMA 20/50 trend:** up if SMA20 > SMA50, the classic trend-following rule and the direction logic of the backend's `baseline-sma-v1`.
- **Buy and hold:** the trading benchmark.

## M5. Evaluation

### M5-1. Walk-forward, not random splits
- Train on all data before a test window, predict the next 63 trading days (about a quarter), add them to the training data, retrain, and repeat. The first test window starts after 500 trading days of history. Crypto has 42 folds from 2019-09 to 2026-11.
- **Why:** a random train/test split puts future days in the training set, so the model "knows" the market regime it's being tested on. Walk-forward copies how the model is really used.

### M5-2. Purging overlapping targets
- A row's label is known only 5 days later. Training rows are therefore kept only if their **outcome date** (`target_date`) is before the test window starts. Without this, the last training rows' labels would be computed from prices inside the test window, which is subtle leakage. A unit test asserts it for every fold.

### M5-3. Metrics
- **Accuracy and balanced accuracy:** easy to explain. Balanced accuracy isn't fooled by predicting the majority class.
- **ROC AUC:** threshold-free ranking quality. 0.5 is chance.
- **Brier score:** the mean squared error of probabilities, a *proper scoring rule* that rewards honest, well-calibrated probabilities. The constant base-rate predictor scores about 0.25.
- **95% block-bootstrap interval for AUC:** whole test windows are resampled 500 times, not individual days, because neighbouring days share overlapping 5-day outcomes. Row-level resampling would make the interval look far tighter than it really is.

### M5-4. Backtest
- **Long-or-cash with hysteresis**, using the same thresholds as the advisories:
  - `buy` → go long
  - `sell` → go to cash
  - `hold`/`watch` → keep the current position
- The position chosen at day *t*'s close earns day *t+1*'s return, so there's no same-day look-ahead.
- **0.1% cost per position change** is a rough estimate of brokerage plus taxes or exchange fees.
- **Reported:** total return, CAGR, Sharpe ratio, maximum drawdown, time in market and number of trades, against buy-and-hold over the same period. Averages are equal-weighted across assets.
- **Bug found and fixed during testing:** max drawdown first ignored the starting capital, so a strategy that lost money on day one reported 0% drawdown. A unit test now covers it.

### M5-5. Model selection by Brier score
- The selected model's probability is shown to users as "confidence", so the model whose probabilities are most trustworthy should win. The first version selected by AUC and picked the MLP (AUC 0.514), but its Brier score (0.261) was worse than the constant baseline (0.2505): it was **over-confident**. Selecting by Brier score picks logistic regression (0.2525).
- "Reliable edge" requires **both** an AUC interval above 0.5 **and** a Brier score no worse than always-up. The report and every advisory's rationale state the result.

## M6. Results (seven candidates, out-of-sample)

Every number below is from walk-forward testing on data the model never saw. ✅ = selected (lowest Brier score).

### M6-1. Stocks (10 NSE large caps, 2010-01 → 2026-11)
| Model | AUC (95% CI) | Brier | Strategy CAGR |
|---|---|---|---|
| Always up | 0.475 (0.458–0.492) | 0.2493 | 0.0% |
| SMA trend | 0.488 (0.477–0.497) | 0.2615 | 3.6% |
| Logistic regression | 0.495 (0.481–0.508) | 0.2503 | 9.2% |
| MLP | 0.502 (0.491–0.513) | 0.2557 | 7.3% |
| Random forest ✅ | 0.503 (0.492–0.515) | 0.2498 | 11.4% |
| Gradient boosting | 0.503 (0.493–0.514) | 0.2503 | 11.2% |
| XGBoost | 0.505 (0.495–0.517) | 0.2512 | 10.9% |
| LSTM | 0.502 (0.488–0.515) | 0.2498 | 10.1% |
| GRU | 0.502 (0.488–0.516) | 0.2501 | 9.2% |
| Buy and hold | — | — | 11.7% |

- **Selected: random forest** (Brier 0.2498, tied with the LSTM to four decimals and narrowly ahead on the unrounded score).
- **No reliable edge.** Every AUC interval contains 0.5, and no model's Brier score beats always-up (0.2493). Stocks rose in 52.9% of 5-day windows, and a constant forecast of that rate is hard to beat.
- The tree models came closest to buy-and-hold (11.4% and 11.2% vs 11.7% CAGR, same Sharpe 0.55) mainly by staying invested over 90% of the time.

### M6-2. Crypto (BTC, ETH, SOL, BNB, XRP, 2019-09 → 2026-11)
| Model | AUC (95% CI) | Brier | Strategy CAGR |
|---|---|---|---|
| Always up | 0.479 (0.444–0.513) | 0.2505 | 0.0% |
| SMA trend | 0.496 (0.475–0.514) | 0.2608 | 38.1% |
| Logistic regression | 0.502 (0.482–0.521) | 0.2525 | 11.6% |
| MLP | 0.514 (0.496–0.533) | 0.2613 | 15.8% |
| Random forest | 0.503 (0.480–0.524) | 0.2517 | 24.2% |
| Gradient boosting | 0.511 (0.491–0.532) | 0.2535 | 18.1% |
| XGBoost | 0.511 (0.491–0.531) | 0.2567 | 15.6% |
| LSTM ✅ | 0.507 (0.482–0.529) | 0.2510 | 33.8% |
| GRU | 0.497 (0.469–0.521) | 0.2522 | 5.1% |
| Buy and hold | — | — | 35.8% |

- **Selected: LSTM** (Brier 0.2510), but still **no reliable edge**: its AUC interval (0.482–0.529) contains 0.5, and its Brier score is worse than always-up (0.2505).
- The LSTM strategy had the best backtest of the candidates (33.8% CAGR, Sharpe 0.75) but still trailed buy-and-hold (35.8%, Sharpe 0.80) and the simple SMA trend rule (38.1%, 0.83). It stayed invested 81% of the time.

### M6-3. What the comparison shows
- **Model complexity doesn't help.** Linear, tree-based (random forest, gradient boosting, XGBoost), feed-forward and recurrent models all land at AUC ≈ 0.50 on both asset classes. XGBoost, added last, scored AUC 0.505 on stocks and 0.511 on crypto, with Brier scores (0.2512, 0.2567) worse than the selected models, so it didn't change the selection. If the 30-day sequence held exploitable information, the LSTM/GRU should have found it; they didn't.
- **This strengthens the null result.** "No model finds an edge" across seven models, four model families and two markets is a much stronger conclusion than "logistic regression finds no edge", and it agrees with weak-form market efficiency.
- **The selected models change, the conclusion doesn't.** Because every candidate is near chance, which one has the lowest Brier score is close to arbitrary (the stock winner leads by less than 0.0001). The selection rule is kept anyway, because it's decided in advance rather than by looking at results.
- **Signals differ between models.** On 2026-11-13 the LSTM rated ETH, SOL and XRP `buy` (P(up) 0.59–0.66, after RSI fell to 23–30), while the earlier logistic model leaned slightly down on the same coins. Disagreement between models with no proven edge is expected; each advisory's rationale shows the model's walk-forward accuracy and AUC so users can judge.

## M7. From probability to advisory
- `high_risk` when annualised 30-day volatility is ≥ 85% (same cut-off as the backend baseline). Otherwise:
  - P(up) ≥ 0.55 → `buy`
  - P(up) ≤ 0.45 → `sell`
  - within 0.03 of either threshold → `watch` (leaning)
  - anything else → `hold`
- `confidence = max(p, 1 − p)`, `riskScore = min(volatility, 1)`.
- The rationale includes the model's probability, key indicator values **and its walk-forward accuracy and AUC**, so the user sees how reliable the model has been. The chat assistant repeats it.
- Advisories are dated with the **run date**, so they replace the backend's rule-based advisory for the same day. The rationale states the last data date.

## M8. Integration with the backend
- Uses the backend's service-key endpoints (`X-Service-Key`), with no direct database access, so the backend stays the single owner of its data and validation.
- `publish` replaces each asset's price history with the real data via `PUT /assets/:id/prices` with `replace: true`, a backend change made for this. Upserting alone would have left synthetic demo candles in place, e.g. a synthetic candle for today becoming the "latest price".
- Assets are matched by `symbol + assetType`, so the ML side never needs database UUIDs.

## M9. Reproducibility and testing
- Package versions are pinned in `requirements.txt`, and every model uses `random_state = 42`.
- Downloaded data and models are git-ignored but fully reproducible with `python -m finsight_ml all`. Reports are kept.
- 29 unit tests (built-in `unittest`, no pytest) cover:
  - feature shape and warm-up
  - no look-ahead
  - the target and target dates
  - walk-forward purging and non-overlap
  - baselines
  - a sanity check that logistic regression learns a planted signal
  - the AUC interval on pure noise containing 0.5
  - signal mapping
  - hysteresis
  - backtest returns, costs and drawdown
  - split adjustment and cleaning
  - sequence windows without look-ahead
  - tree models learning a planted signal
  - the GRU learning a planted temporal pattern a single row can't see
  - GARCH recovering known parameters, GARCH forecasts without look-ahead, the interval score, volatility-scaled ranges being calibrated and beating a constant range, quantile trees learning conditional width, and the skill interval

### M9-1. Adding one model without re-running everything
- `python -m finsight_ml evaluate --models xgboost` evaluates only the named models (plus the cheap baselines) and merges them into the saved report, then re-runs model selection across all candidates.
- **Why it's valid:** every model is fitted independently on the same deterministic walk-forward folds with fixed seeds, so the other models' results can't change.
- **Safeguards:** the merge is refused if the saved report used different assets or a different number of test rows. As a check, the recomputed baselines must match the saved ones; for the XGBoost run they matched exactly (always-up Brier 0.249329… on stocks, 0.250520… on crypto).
- **Cost:** 3.5 minutes instead of ~70 for a full run.

## M10. Range forecasts (80% interval for the close in 5 days)

### M10-1. Why switch the headline forecast from direction to range
- Seven direction models found no edge (M6). Finance research says the *size* of moves is far more predictable than their direction: volatility clusters (calm weeks follow calm weeks) and mean-reverts. A range forecast can therefore have real skill where a direction forecast can't.
- **User decision (2026-11-13):** forecast an 80% interval for the close in 5 trading days and make it the main forecast; keep the direction signal as a secondary item labelled "no proven edge".
- **Rejected:** the high–low range over the next 5 days (harder to evaluate and explain), and dropping the direction signal (it stays for comparison in the paper).

### M10-2. Target and output
- Target: the 5-day log return r = log(close[t+5] / close[t]). Each model predicts its 10th and 90th percentiles; the price range is close[t] · exp(quantile).
- Same rows, purged walk-forward folds and test windows as the direction models, so both sets of results describe the same out-of-sample days.

### M10-3. Models
| Model | Type | How the range is formed |
|---|---|---|
| Constant range | naive baseline | the training set's 10th/90th percentiles, every day |
| Historical volatility | classic | 20-day volatility × √5, times quantiles of the standardised return fitted on training data |
| GARCH(1,1) | classic finance | 5-day volatility forecast from a GARCH(1,1) fitted per asset by maximum likelihood, times fitted quantiles |
| Quantile gradient boosting | ML | sklearn `HistGradientBoostingRegressor(loss="quantile")`, one model per quantile |
| Quantile XGBoost | ML | `reg:quantileerror`, one model per quantile |
| Quantile LSTM | ML | 30-day indicator windows, pinball loss, same regularisation and time-ordered early stopping as M4-4 |

- **Volatility scaling.** The ML models learn quantiles of z = r / s, where s is the 20-day volatility × √5, then multiply back by s. One pooled model can then serve calm large caps and volatile coins: it only has to learn how today's indicators shift the standardised quantiles.
- **GARCH written with scipy, not the `arch` package.** Installing `arch` was blocked by the session's permission check (the project rule is to ask before unusual installs), so GARCH(1,1) was implemented directly: zero mean, normal errors, ω > 0, α, β ≥ 0, α + β < 1, fitted with L-BFGS-B. The variance recursion uses `scipy.signal.lfilter`, so a fit takes milliseconds. A unit test checks it recovers known parameters from simulated data. Parameters are refitted per asset at every fold using only data before the test window.
- **Quantile crossing:** if a model's 10th percentile comes out above its 90th, the two are swapped.

### M10-4. Evaluation
- **Coverage:** share of test days whose actual close fell inside the range. A calibrated 80% range covers about 80%.
- **Interval (Winkler) score:** width + (2/α) × miss distance, with α = 0.2. It's a proper scoring rule, so a model can't improve it by making ranges wider or narrower than it believes; it rewards ranges that are both narrow and honest. Lower is better, and selection uses it.
- **Skill:** 1 − score(model) / score(constant), with a 95% block-bootstrap interval resampling whole 63-day test windows (as for AUC, M5-3). "Reliable skill" means the interval excludes zero. Skill over the historical-volatility model is also reported, to show whether ML adds anything beyond a classic method.

### M10-5. Results
**Stocks** (2010-01-29 → 2026-11-03)

| Model | Coverage (target 80%) | Avg. width | Interval score | Skill vs constant (95% CI) | Skill vs hist. vol (95% CI) |
|---|---|---|---|---|---|
| Constant range (baseline) | 87.7% | 11.0% | 0.1409 | +0.0% (+0.0 to +0.0) | -3.1% (-5.2 to -1.3) |
| Historical volatility (20-day) | 79.8% | 9.3% | 0.1367 | +3.0% (+1.3 to +4.9) | +0.0% (+0.0 to +0.0) |
| GARCH(1,1) | 82.9% | 9.6% | 0.1335 | +5.2% (+3.9 to +6.7) | +2.3% (+1.6 to +3.0) |
| Quantile gradient boosting ✅ | 81.3% | 9.2% | 0.1333 | +5.4% (+4.1 to +7.0) | +2.5% (+1.8 to +3.2) |
| Quantile XGBoost | 81.6% | 9.3% | 0.1337 | +5.1% (+3.6 to +6.8) | +2.2% (+1.7 to +2.7) |
| Quantile LSTM | 81.2% | 9.2% | 0.1341 | +4.9% (+3.3 to +6.7) | +1.9% (+1.2 to +2.6) |

**Crypto** (2019-09-08 → 2026-11-06)

| Model | Coverage (target 80%) | Avg. width | Interval score | Skill vs constant (95% CI) | Skill vs hist. vol (95% CI) |
|---|---|---|---|---|---|
| Constant range (baseline) | 84.1% | 22.9% | 0.3506 | +0.0% (+0.0 to +0.0) | +1.8% (-1.4 to +5.1) |
| Historical volatility (20-day) | 80.0% | 22.8% | 0.3570 | -1.8% (-5.4 to +1.4) | +0.0% (+0.0 to +0.0) |
| GARCH(1,1) ✅ | 83.2% | 22.9% | 0.3397 | +3.1% (+1.4 to +4.8) | +4.9% (+3.1 to +6.7) |
| Quantile gradient boosting | 79.6% | 20.9% | 0.3440 | +1.9% (-0.5 to +4.2) | +3.6% (+1.5 to +5.8) |
| Quantile XGBoost | 81.0% | 21.6% | 0.3416 | +2.6% (+0.3 to +4.8) | +4.3% (+2.9 to +5.9) |
| Quantile LSTM | 77.7% | 19.9% | 0.3473 | +0.9% (-1.7 to +3.4) | +2.7% (+0.7 to +5.1) |

- **Reliable skill on both markets** — the positive result the direction models couldn't give. Stocks: quantile gradient boosting is 5.4% better than a constant range (95% CI +4.1% to +7.0%) and well calibrated (81.3% coverage). Crypto: GARCH is 3.1% better (+1.4% to +4.8%), slightly cautious (83.2% coverage).
- **Stocks:** every volatility-aware model beat the constant range, and the ML models beat the classic 20-day method by about 2–2.5%.
- **Crypto:** the 20-day method was *worse* than a constant range, while GARCH won clearly. Crypto volatility spikes and decays quickly, and GARCH models exactly that decay towards the long-run level, whereas a 20-day window keeps a spike in for weeks.
- **The quantile LSTM didn't beat simpler models again:** fourth on stocks, and too narrow on crypto (77.7% coverage).
- The constant range over-covers (87.7% on stocks) because its percentiles come from the whole training history, including volatile periods like 2008 and 2020, which are wider than a typical recent week.

### M10-6. In the app
- Each advisory carries `priceLow`, `priceHigh`, `rangeLevel` (0.8), `horizonDays` (5) and `rangeModelVersion`, and its rationale leads with the range and its tested coverage.
- The asset page shows a range bar with the latest close marked, and a dashed forecast cone after the last close on the price chart. The cone widens with √time from the last close to the 5-day range.
- **No cone on the portfolio chart.** Adding up assets' percentiles doesn't give the portfolio's percentiles, because assets don't move together perfectly; a correct portfolio range would need a correlation model (future work). Dashboard cards show each holding's range instead.
