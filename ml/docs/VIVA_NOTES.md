# FinSight ML — Viva Notes

## Problem and data

**Q1. Why predict 5-day direction instead of the actual price?**
An exact price forecast is mostly noise, while the app needs a decision and a confidence. A probability that the price will be higher in 5 trading days maps directly to buy/hold/sell and to the confidence shown to users. Next-day direction is too noisy. A 20-day horizon leaves fewer independent samples for testing. 5 days is one trading week, a realistic horizon for a retail investor.

**Q2. Where does the data come from, and what cleaning did you need?**
Stocks come from Alpha Vantage's official API (free key; Indian equities through the BSE listing). Crypto comes from Binance's public klines API. Two problems needed handling:
- Binance's current-day candle is still forming, so only closed candles are kept.
- Alpha Vantage's free data isn't split-adjusted, so a 1:1 bonus issue looks like a 50% crash. I detect overnight gaps close to 1/2, 1/3, 1/4, 1/5 or 1/10 and rescale earlier prices.

Both have unit tests.

**Q3. Why did the first version have no random forests or LSTMs?**
Windows Smart App Control on my machine blocked their compiled DLLs, so the first version used only logistic regression and an MLP. Because the model interface is generic (`fit` / `predict_proba`), adding random forest, gradient boosting, LSTM and GRU later took no changes to the evaluation code once Smart App Control was turned off.

## Features and models

**Q4. What features does the model use, and how do you guarantee there's no look-ahead bias?**
19 technical indicators: returns, moving-average ratios, volatility, RSI, MACD, Bollinger %B, ATR, volume z-score and position in the 52-week range. All are ratios, so one model can learn across assets with very different prices. Each feature at day *t* uses only data up to *t*. A unit test changes every price after *t* and checks that no feature at or before *t* changes.

**Q5. Which models did you compare, and why compare against "always up"?**
Six candidates: logistic regression, an MLP, random forest, gradient boosting, LSTM and GRU. They span linear, tree-based, feed-forward and recurrent families.
- Logistic regression is interpretable and, with strong regularisation, hard to over-fit noisy financial data.
- The MLP can capture non-linear combinations of indicators.
- Baselines matter because markets drift upward: "always predict up" already scores above 50% in a bull market. A model is only useful if it beats that and the simple SMA-trend rule.

## Evaluation

**Q6. What is walk-forward validation and why not use a random train/test split?**
Train on everything before a test window, predict the next 63 trading days, then roll forward and retrain. That's how the model is really used. A random split puts future days in the training set, so the model effectively sees the future, and its scores come out much too optimistic.

**Q7. What is "purging" in your walk-forward split?**
A day's label (up in 5 days?) only becomes known 5 days later. If a training row from just before the test window were kept, its label would be computed from prices inside the test window, so information would leak. I keep a training row only if its outcome date is before the test window starts. A unit test checks this for every fold.

**Q8. Why select models by Brier score rather than accuracy or AUC?**
The app shows the model's probability to users as "confidence", so the probabilities must be honest. The Brier score (mean squared error of probabilities) is a proper scoring rule: it's best when probabilities are both informative and well calibrated. The MLP had the highest AUC (0.514), but its Brier score was worse than a constant 50/50 guess, which means it was over-confident. Logistic regression was better calibrated, so it was selected.

**Q9. How do you know whether a result is real or luck?**
I compute a 95% confidence interval for AUC with a block bootstrap: I resample whole 63-day test windows, not individual days, because neighbouring days share overlapping 5-day outcomes. I only claim an edge if the interval is entirely above 0.5 **and** the Brier score beats the always-up baseline. A unit test confirms that on pure noise the interval contains 0.5.

## Results

**Q10. What did you find, and is a "no edge" result a failure?**
For crypto (2019–2026, out-of-sample), no model had a statistically reliable edge. Logistic regression's AUC was 0.502 (CI 0.482–0.521), and the model-timed strategies trailed buy-and-hold. This isn't a failure of the project: it agrees with the weak form of the Efficient Market Hypothesis, which says past prices of liquid assets carry little exploitable information. The contribution is a pipeline that measures that honestly, with no look-ahead or overlap leakage and with uncertainty reported, instead of showing an inflated accuracy. The advisories reflect it: mostly hold/watch, confidence near 50%, and the walk-forward accuracy shown in every rationale.

**Q11. How does the backtest work, and why include trading costs?**
Long when the signal is buy, in cash on sell, otherwise keep the position. The position chosen at today's close earns tomorrow's return, so there's no same-day look-ahead. A 0.1% cost is charged on every change, because frequent switching can turn a tiny edge into a loss. I report CAGR, Sharpe ratio, maximum drawdown and time in market, against buy-and-hold over the same dates.

**Q12. How do the predictions reach the app?**
`python -m finsight_ml publish` calls the backend's service-key endpoints. It replaces each asset's price history with the real data (`replace: true`, atomically), then upserts today's advisories, matched by symbol. The backend stays the only owner of the database. ML advisories replace the rule-based baseline for the same day, and the chat assistant explains them.

**Q13. What would you improve next?**
- Add tree models once they can load.
- Add features beyond price: news sentiment (the backend already stores it), market-wide factors (NIFTY, BTC dominance), fundamentals.
- Calibrate probabilities (Platt or isotonic).
- Test longer horizons.
- Retrain on a schedule.
- Get a licensed data feed (e.g. NSE's official data or a paid vendor) instead of unofficial Yahoo access.

## Deep learning

**Q17. Did you try an LSTM or RNN? How did it compare?**
Yes, an LSTM and a GRU (PyTorch), each reading the last 30 trading days of the 19 indicators. They were tested in the same walk-forward folds, on the same rows, as the other four models. Neither found an edge: AUC 0.502 on stocks for both, 0.507 (LSTM) and 0.497 (GRU) on crypto, all with intervals containing 0.5. The LSTM was selected for crypto because its probabilities had the lowest Brier score, but it still didn't beat always predicting the base rate. So a sequence model doesn't extract more from past prices than a linear one, which supports the efficient-market interpretation.

**Q18. How did you make sure the LSTM comparison was fair and leak-free?**
- Each 30-day window uses only the same asset's past rows, ending on the prediction day; a unit test checks this.
- All models are scored on identical rows and folds.
- Early stopping uses the most recent 15% of each training window by date, never a random sample, which would validate on the past using the future.
- The network is deliberately small (16 units, dropout, weight decay) because daily returns are mostly noise.
- A unit test proves the GRU can use sequence information when it exists: on a planted pattern (sign of the last five steps' sum) it reaches AUC > 0.9 and beats a one-row model by more than 0.1.

**Q20. Did you try XGBoost?**
Yes. It's added as a seventh candidate with the same regularisation idea as the other tree models (shallow trees, small learning rate, about 200 rows per leaf, row and column subsampling). AUC 0.505 on stocks and 0.511 on crypto, both intervals containing 0.5, and its Brier scores were worse than the selected models'. So it confirms the result rather than changing it. Because each model is trained independently on fixed folds, I evaluated just XGBoost and merged it into the saved report; the recomputed baselines matched the saved ones exactly, which shows the merge is consistent.

**Q19. Your random forest and LSTM were selected. Does that mean they're better models?**
Not meaningfully. Every candidate is near chance, and the stock winner beats the runner-up by less than 0.0001 Brier. The selection rule (lowest Brier score) was fixed before seeing results, so I apply it consistently instead of picking the model I like. The honest claim is that none of the six has a reliable edge, and the app's advisories say so.

## Stocks

**Q14. Why did you switch from Alpha Vantage to Yahoo Finance, and what are the risks?**
Alpha Vantage moved full daily history to its paid plan. The free tier returns only 100 days, which is far too short for a 500-day training window plus walk-forward testing. Yahoo, via the open-source `yfinance` library, gives free split-adjusted history back to the 1990s. The risks: it's unofficial (no SLA, terms of use, can rate-limit or change), so all access is isolated in one function and cached, and I note it as a limitation. In production you'd buy a licensed feed.

**Q15. How did you check the stock data quality, and why start in 2007?**
I scanned every stock for one-day moves above 25% and checked each against known events. Before 2007 there were obvious bad ticks, e.g. RELIANCE ×4.4 one day and ×0.23 the next, plus TCS prices from before it listed. After 2007, every big move was real: the 2008 crash, the May 2009 election rally, SBI's 2017 recapitalisation. I also drop zero-volume rows, which are exchange-closure placeholders. Bad ticks matter because one fake 300% return poisons every rolling feature for 200 days.

**Q16. What did the stock evaluation show, and how does it compare with crypto?**
The same result: no reliable edge. Logistic regression's AUC is 0.495 (CI 0.481–0.508), and its Brier score is marginally worse than always predicting the 52.9% base rate. Its strategy stayed invested 93% of the time and slightly trailed buy-and-hold (9.2% vs 11.7% CAGR). Two different markets giving the same null result supports the efficient-market reading and shows the evaluation isn't biased towards finding an edge.

## Range forecasts

**Q21. Why did you switch the main forecast from buy/sell to a price range?**
Seven direction models found no edge, which matches the efficient-market hypothesis. But the size of price moves is predictable even when the direction isn't: volatility clusters and mean-reverts. So the app now forecasts an 80% range for the close in 5 trading days, and the direction signal stays as a secondary item labelled "no proven edge".

**Q22. How do you evaluate a range forecast?**
Two things matter: calibration and sharpness. Coverage checks calibration: an 80% range should contain the actual close about 80% of the time. The interval (Winkler) score combines both: the width plus 10× any miss distance. It's a proper scoring rule, so a model can't improve its score by being vaguer or more confident than it really is. Skill is the improvement over a constant range, with a block-bootstrap 95% interval over test windows.

**Q23. What did you find?**
Reliable skill on both markets. Stocks: quantile gradient boosting was 5.4% better than a constant range (95% CI 4.1–7.0%) with 81.3% coverage. Crypto: GARCH(1,1) was 3.1% better (1.4–4.8%) with 83.2% coverage. On crypto, the simple 20-day volatility method was worse than a constant range, while GARCH won, because crypto volatility spikes decay quickly and GARCH models that decay. The quantile LSTM again didn't beat simpler models.

**Q24. What is GARCH(1,1) and how did you implement it?**
It models tomorrow's variance as σ²ₜ₊₁ = ω + α·rₜ² + β·σ²ₜ: a long-run level, a reaction to yesterday's shock, and persistence. Multi-day forecasts decay towards the long-run variance ω / (1 − α − β). I fitted it by maximum likelihood with scipy (L-BFGS-B, constraint α + β < 1), computing the variance recursion as a linear filter so each fit is fast. A unit test checks it recovers known parameters from simulated data, and another checks that changing future returns doesn't change past forecasts. It's refitted per asset at every fold using only data before the test window.

**Q25. Why isn't there a forecast cone on the portfolio chart?**
Percentiles don't add up: the 10th percentile of a portfolio isn't the sum of its assets' 10th percentiles, because assets don't all fall together. A correct portfolio range needs the correlations between assets, which I left as future work. Each holding's own range is shown on the dashboard instead.
