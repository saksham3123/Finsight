# FinSight ML — Walk-forward Evaluation

Target: will the close be higher in 5 trading days? Models are retrained every 63 trading days on all earlier data, and every number below is out-of-sample.
Backtest: long when P(up) ≥ 0.55, cash when P(up) ≤ 0.45, otherwise keep the position; 0.1% cost per trade. Averages are equal-weighted across assets.

> Past performance in a backtest does not guarantee future results. This is a research prototype, not financial advice.

## Stocks (BHARTIARTL, HDFCBANK, HINDUNILVR, ICICIBANK, INFY, ITC, LT, RELIANCE, SBIN, TCS)

Out-of-sample period: 2010-01-29 → 2026-11-03. Share of 5-day windows that went up: 52.9%.

| Model | Accuracy | Balanced acc. | AUC (95% CI) | Brier | Strategy CAGR | Sharpe | Max drawdown | Time in market |
|---|---|---|---|---|---|---|---|---|
| Always up (baseline) | 52.9% | 50.0% | 0.475 (0.458–0.492) | 0.2493 | 0.0% | 0.00 | 0.0% | 0.0% |
| SMA 20/50 trend (baseline) | 49.2% | 48.8% | 0.488 (0.477–0.497) | 0.2615 | 3.6% | 0.28 | -50.6% | 57.9% |
| Logistic regression | 52.0% | 49.8% | 0.495 (0.481–0.508) | 0.2503 | 9.2% | 0.48 | -53.7% | 92.8% |
| Neural network (MLP) | 51.0% | 49.9% | 0.502 (0.491–0.513) | 0.2557 | 7.3% | 0.42 | -49.5% | 74.5% |
| Random forest ✅ | 52.7% | 50.5% | 0.503 (0.492–0.515) | 0.2498 | 11.4% | 0.55 | -50.7% | 94.3% |
| Gradient boosting | 52.4% | 50.5% | 0.503 (0.493–0.514) | 0.2503 | 11.2% | 0.55 | -50.5% | 90.7% |
| LSTM (recurrent) | 52.1% | 49.8% | 0.502 (0.488–0.515) | 0.2498 | 10.1% | 0.50 | -51.1% | 95.1% |
| GRU (recurrent) | 51.8% | 50.0% | 0.502 (0.488–0.516) | 0.2501 | 9.2% | 0.48 | -50.1% | 87.8% |
| XGBoost | 51.9% | 50.3% | 0.505 (0.495–0.517) | 0.2512 | 10.9% | 0.55 | -49.8% | 83.6% |
| Buy and hold | — | — | — | — | 11.7% | 0.55 | -50.5% | 100% |

Selected model: **Random forest** (lowest out-of-sample Brier score). AUC 0.503, 95% block-bootstrap interval 0.492–0.515. ⚠️ **No reliable edge**: the interval includes 0.5 (coin-flip level) or its probabilities are no better than the always-up baseline. Its signals should be read as weak, and most will be 'hold'.

Per-asset results for the selected model:

| Asset | Accuracy | Strategy return | Buy-and-hold return | Strategy max DD | Buy-and-hold max DD | Trades |
|---|---|---|---|---|---|---|
| RELIANCE | 52.9% | 383.3% | 448.2% | -41.2% | -45.1% | 27 |
| TCS | 53.2% | 640.0% | 561.8% | -56.5% | -56.5% | 19 |
| HDFCBANK | 54.3% | 589.6% | 803.3% | -41.1% | -41.1% | 13 |
| INFY | 53.8% | 272.0% | 264.6% | -50.7% | -50.7% | 13 |
| ICICIBANK | 50.9% | 1001.4% | 843.3% | -52.3% | -52.3% | 35 |
| HINDUNILVR | 50.9% | 674.4% | 716.0% | -40.1% | -40.1% | 15 |
| ITC | 51.0% | 269.0% | 248.7% | -57.0% | -57.0% | 9 |
| SBIN | 52.6% | 357.4% | 376.0% | -60.0% | -59.5% | 27 |
| BHARTIARTL | 53.6% | 747.9% | 648.7% | -47.5% | -47.5% | 35 |
| LT | 53.5% | 306.2% | 523.3% | -60.3% | -55.6% | 21 |

## Cryptos (BNB, BTC, ETH, SOL, XRP)

Out-of-sample period: 2019-09-08 → 2026-11-06. Share of 5-day windows that went up: 50.9%.

| Model | Accuracy | Balanced acc. | AUC (95% CI) | Brier | Strategy CAGR | Sharpe | Max drawdown | Time in market |
|---|---|---|---|---|---|---|---|---|
| Always up (baseline) | 50.1% | 49.4% | 0.479 (0.444–0.513) | 0.2505 | 0.0% | 0.00 | 0.0% | 0.0% |
| SMA 20/50 trend (baseline) | 49.6% | 49.6% | 0.496 (0.475–0.514) | 0.2608 | 38.1% | 0.83 | -65.6% | 51.0% |
| Logistic regression | 49.6% | 49.4% | 0.502 (0.482–0.521) | 0.2525 | 11.6% | 0.52 | -80.5% | 66.4% |
| Neural network (MLP) | 50.5% | 50.5% | 0.514 (0.496–0.533) | 0.2613 | 15.8% | 0.58 | -77.2% | 53.0% |
| Random forest | 50.2% | 50.0% | 0.503 (0.480–0.524) | 0.2517 | 24.2% | 0.67 | -81.8% | 71.5% |
| Gradient boosting | 51.4% | 51.2% | 0.511 (0.491–0.532) | 0.2535 | 18.1% | 0.61 | -78.2% | 60.2% |
| LSTM (recurrent) ✅ | 50.9% | 50.5% | 0.507 (0.482–0.529) | 0.2510 | 33.8% | 0.75 | -77.8% | 81.3% |
| GRU (recurrent) | 50.0% | 50.0% | 0.497 (0.469–0.521) | 0.2522 | 5.1% | 0.39 | -78.2% | 55.7% |
| XGBoost | 51.0% | 50.9% | 0.511 (0.491–0.531) | 0.2567 | 15.6% | 0.56 | -81.4% | 56.6% |
| Buy and hold | — | — | — | — | 35.8% | 0.80 | -81.3% | 100% |

Selected model: **LSTM (recurrent)** (lowest out-of-sample Brier score). AUC 0.507, 95% block-bootstrap interval 0.482–0.529. ⚠️ **No reliable edge**: the interval includes 0.5 (coin-flip level) or its probabilities are no better than the always-up baseline. Its signals should be read as weak, and most will be 'hold'.

Per-asset results for the selected model:

| Asset | Accuracy | Strategy return | Buy-and-hold return | Strategy max DD | Buy-and-hold max DD | Trades |
|---|---|---|---|---|---|---|
| BTC | 51.2% | 162.9% | 630.8% | -74.5% | -76.6% | 29 |
| ETH | 53.5% | 1251.6% | 1136.4% | -79.3% | -79.3% | 33 |
| SOL | 49.4% | 106.2% | 183.3% | -93.3% | -96.3% | 29 |
| BNB | 51.0% | 1481.6% | 3006.5% | -70.9% | -70.9% | 33 |
| XRP | 49.2% | 1742.3% | 344.2% | -71.2% | -83.2% | 37 |

# Range forecasts (80% interval for the close in 5 trading days)

Each model predicts the 10th and 90th percentiles of the 5-day return. A well-calibrated 80% range contains the actual close about 80% of the time. The interval score (Winkler) adds the range width to 10× any miss distance, so it rewards ranges that are both narrow and honest; lower is better. Skill is the reduction in interval score versus the constant-range baseline, with a 95% block-bootstrap interval.

## Stocks — ranges

Out-of-sample period: 2010-01-29 → 2026-11-03.

| Model | Coverage | Below / above | Avg. width | Interval score | Skill vs constant (95% CI) | Skill vs hist. vol (95% CI) |
|---|---|---|---|---|---|---|
| Constant range (baseline) | 87.7% | 5.8% / 6.5% | 11.0% | 0.1409 | +0.0% (+0.0 to +0.0) | -3.1% (-5.2 to -1.3) |
| Historical volatility (20-day) | 79.8% | 9.5% / 10.7% | 9.3% | 0.1367 | +3.0% (+1.3 to +4.9) | +0.0% (+0.0 to +0.0) |
| GARCH(1,1) | 82.9% | 8.0% / 9.0% | 9.6% | 0.1335 | +5.2% (+3.9 to +6.7) | +2.3% (+1.6 to +3.0) |
| Quantile gradient boosting | 81.3% | 9.1% / 9.6% | 9.2% | 0.1333 | +5.4% (+4.1 to +7.0) | +2.5% (+1.8 to +3.2) |
| Quantile XGBoost | 81.6% | 8.8% / 9.5% | 9.3% | 0.1337 | +5.1% (+3.6 to +6.8) | +2.2% (+1.7 to +2.7) |
| Quantile LSTM | 81.2% | 9.0% / 9.8% | 9.2% | 0.1341 | +4.9% (+3.3 to +6.7) | +1.9% (+1.2 to +2.6) |
| Historical volatility + earnings | 79.9% | 9.4% / 10.7% | 9.3% | 0.1354 | +3.9% (+2.2 to +5.8) | +0.9% (+0.6 to +1.2) |
| GARCH(1,1) + earnings | 83.1% | 8.0% / 9.0% | 9.6% | 0.1324 | +6.0% (+4.6 to +7.5) | +3.1% (+2.5 to +3.7) |
| Quantile gradient boosting + earnings ✅ | 81.2% | 9.1% / 9.7% | 9.2% | 0.1323 | +6.2% (+4.8 to +7.7) | +3.2% (+2.5 to +4.0) |
| Quantile XGBoost + earnings | 81.6% | 8.8% / 9.6% | 9.4% | 0.1329 | +5.7% (+4.2 to +7.4) | +2.7% (+2.2 to +3.3) |

Earnings-aware models against the same model without earnings (9.6% of test days had a results announcement inside the 5-day window). A well-calibrated range should cover about 80% in both groups.

| Model | Gain vs same model without earnings (95% CI) | Coverage in results weeks: without → with | Coverage in other weeks: without → with |
|---|---|---|---|
| Historical volatility + earnings | +0.9% (+0.6 to +1.2) | 65.3% → 78.4% | 81.4% → 80.0% |
| GARCH(1,1) + earnings | +0.8% (+0.6 to +1.1) | 68.7% → 81.1% | 84.5% → 83.3% |
| Quantile gradient boosting + earnings | +0.8% (+0.6 to +1.1) | 66.3% → 76.2% | 82.9% → 81.8% |
| Quantile XGBoost + earnings | +0.6% (+0.4 to +0.8) | 66.4% → 74.4% | 83.3% → 82.4% |

Selected model: **Quantile gradient boosting + earnings** (lowest interval score). ✅ **Reliable skill**: its interval score is 6.2% better than a constant range, and the 95% interval (4.8% to 7.7%) excludes zero.

### Hold-out check (2024-11-04 → 2026-11-03)

The table above picks the winner on the same days it is scored on. Here the winner is picked on 2010-01-29 → 2024-10-25 only, and every model is scored on the final 2 years (4931 forecasts), which played no part in the choice.

| Model | Interval score in selection period | Hold-out coverage | Hold-out avg. width | Hold-out interval score | Hold-out skill vs constant (95% CI) |
|---|---|---|---|---|---|
| Constant range (baseline) | 0.1438 | 88.2% | 9.5% | 0.1201 | +0.0% (+0.0 to +0.0) |
| Historical volatility (20-day) | 0.1396 | 79.7% | 7.9% | 0.1152 | +4.0% (+0.1 to +8.8) |
| GARCH(1,1) | 0.1362 | 82.8% | 8.2% | 0.1141 | +5.0% (+1.2 to +9.4) |
| Quantile gradient boosting | 0.1360 | 83.2% | 8.2% | 0.1140 | +5.1% (+1.3 to +10.2) |
| Quantile XGBoost | 0.1365 | 82.8% | 8.2% | 0.1138 | +5.2% (+1.5 to +10.2) |
| Quantile LSTM | 0.1368 | 82.9% | 8.2% | 0.1140 | +5.1% (+1.4 to +9.6) |
| Historical volatility + earnings | 0.1384 | 79.7% | 7.9% | 0.1139 | +5.2% (+0.8 to +10.4) |
| GARCH(1,1) + earnings | 0.1351 | 83.0% | 8.2% | 0.1128 | +6.0% (+2.1 to +10.7) |
| Quantile gradient boosting + earnings ✅ | 0.1350 | 83.2% | 8.3% | 0.1127 | +6.2% (+2.3 to +11.4) |
| Quantile XGBoost + earnings | 0.1357 | 82.7% | 8.2% | 0.1128 | +6.1% (+2.3 to +11.1) |

Chosen without the hold-out years: **Quantile gradient boosting + earnings** (the same model as on the full period). On the hold-out it covered 83.2% of closes and scored +6.2% (+2.3 to +11.4) against the constant range. ✅ The skill holds on unseen years: the 95% interval excludes zero.

### Coverage tests

Kupiec (right share of misses) and Christoffersen (misses not clustered; both together) tests at the 5% level, run for each of the 10 assets on every 5th forecast so that windows don't overlap. The table counts the assets where a test rejects; with no real problem, about 1 in 20 tests rejects by chance.

| Model | Forecasts tested | Coverage | Kupiec rejects | Independence rejects | Conditional coverage rejects |
|---|---|---|---|---|---|
| Constant range (baseline) | 8270 | 87.7% | 9 of 10 | 3 of 10 | 9 of 10 |
| Historical volatility (20-day) | 8270 | 79.1% | 2 of 10 | 1 of 10 | 2 of 10 |
| GARCH(1,1) | 8270 | 82.6% | 4 of 10 | 1 of 10 | 4 of 10 |
| Quantile gradient boosting | 8270 | 81.1% | 4 of 10 | 0 of 10 | 4 of 10 |
| Quantile XGBoost | 8270 | 81.3% | 4 of 10 | 1 of 10 | 3 of 10 |
| Quantile LSTM | 8270 | 80.8% | 3 of 10 | 0 of 10 | 3 of 10 |
| Historical volatility + earnings | 8270 | 79.0% | 2 of 10 | 1 of 10 | 2 of 10 |
| GARCH(1,1) + earnings | 8270 | 82.4% | 4 of 10 | 1 of 10 | 4 of 10 |
| Quantile gradient boosting + earnings ✅ | 8270 | 80.7% | 4 of 10 | 1 of 10 | 3 of 10 |
| Quantile XGBoost + earnings | 8270 | 81.0% | 3 of 10 | 1 of 10 | 2 of 10 |

## Cryptos — ranges

Out-of-sample period: 2019-09-08 → 2026-11-06.

| Model | Coverage | Below / above | Avg. width | Interval score | Skill vs constant (95% CI) | Skill vs hist. vol (95% CI) |
|---|---|---|---|---|---|---|
| Constant range (baseline) | 84.1% | 7.9% / 8.0% | 22.9% | 0.3506 | +0.0% (+0.0 to +0.0) | +1.8% (-1.4 to +5.1) |
| Historical volatility (20-day) | 80.0% | 9.8% / 10.2% | 22.8% | 0.3570 | -1.8% (-5.4 to +1.4) | +0.0% (+0.0 to +0.0) |
| GARCH(1,1) ✅ | 83.2% | 8.2% / 8.6% | 22.9% | 0.3397 | +3.1% (+1.4 to +4.8) | +4.9% (+3.1 to +6.7) |
| Quantile gradient boosting | 79.6% | 9.9% / 10.5% | 20.9% | 0.3440 | +1.9% (-0.5 to +4.2) | +3.6% (+1.5 to +5.8) |
| Quantile XGBoost | 81.0% | 9.3% / 9.7% | 21.6% | 0.3416 | +2.6% (+0.3 to +4.8) | +4.3% (+2.9 to +5.9) |
| Quantile LSTM | 77.7% | 11.3% / 11.0% | 19.9% | 0.3473 | +0.9% (-1.7 to +3.4) | +2.7% (+0.7 to +5.1) |

Selected model: **GARCH(1,1)** (lowest interval score). ✅ **Reliable skill**: its interval score is 3.1% better than a constant range, and the 95% interval (1.4% to 4.8%) excludes zero.

### Hold-out check (2024-11-06 → 2026-11-06)

The table above picks the winner on the same days it is scored on. Here the winner is picked on 2019-09-08 → 2024-10-31 only, and every model is scored on the final 2 years (3655 forecasts), which played no part in the choice.

| Model | Interval score in selection period | Hold-out coverage | Hold-out avg. width | Hold-out interval score | Hold-out skill vs constant (95% CI) |
|---|---|---|---|---|---|
| Constant range (baseline) | 0.3776 | 87.9% | 21.3% | 0.2840 | +0.0% (+0.0 to +0.0) |
| Historical volatility (20-day) | 0.3868 | 80.6% | 18.5% | 0.2821 | +0.7% (-4.8 to +6.5) |
| GARCH(1,1) ✅ | 0.3675 | 84.5% | 19.2% | 0.2703 | +4.8% (+1.5 to +8.5) |
| Quantile gradient boosting | 0.3732 | 83.2% | 18.3% | 0.2704 | +4.8% (+0.7 to +8.8) |
| Quantile XGBoost | 0.3700 | 83.2% | 18.4% | 0.2701 | +4.9% (+1.2 to +9.0) |
| Quantile LSTM | 0.3762 | 83.3% | 19.0% | 0.2744 | +3.4% (-1.1 to +8.0) |

Chosen without the hold-out years: **GARCH(1,1)** (the same model as on the full period). On the hold-out it covered 84.5% of closes and scored +4.8% (+1.5 to +8.5) against the constant range. ✅ The skill holds on unseen years: the 95% interval excludes zero.

### Coverage tests

Kupiec (right share of misses) and Christoffersen (misses not clustered; both together) tests at the 5% level, run for each of the 5 assets on every 5th forecast so that windows don't overlap. The table counts the assets where a test rejects; with no real problem, about 1 in 20 tests rejects by chance.

| Model | Forecasts tested | Coverage | Kupiec rejects | Independence rejects | Conditional coverage rejects |
|---|---|---|---|---|---|
| Constant range (baseline) | 2502 | 83.7% | 4 of 5 | 2 of 5 | 4 of 5 |
| Historical volatility (20-day) | 2502 | 79.9% | 0 of 5 | 2 of 5 | 1 of 5 |
| GARCH(1,1) ✅ | 2502 | 83.7% | 3 of 5 | 0 of 5 | 2 of 5 |
| Quantile gradient boosting | 2502 | 79.5% | 1 of 5 | 0 of 5 | 0 of 5 |
| Quantile XGBoost | 2502 | 81.3% | 1 of 5 | 0 of 5 | 1 of 5 |
| Quantile LSTM | 2502 | 77.7% | 1 of 5 | 1 of 5 | 1 of 5 |

