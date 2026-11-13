// Usage (needs Node and the "docx" npm package): node docs/build_research_doc.cjs docs/FinSight_ML_Research.docx reports
// Builds ml/docs/FinSight_ML_Research.docx. Results are read from ml/reports/evaluation_*.json,
// so re-running after a new evaluation (e.g. once stock data exists) refreshes every number.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, LevelFormat,
} = require("docx");

const [out, reportsDir] = process.argv.slice(2);
const FONT = "Times New Roman";

const runs = (parts) => (Array.isArray(parts) ? parts : [parts]).map((t) => (typeof t === "string" ? new TextRun(t) : t));
const p = (text) => new Paragraph({ spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, children: runs(text) });
const todo = (text) => p(new TextRun({ text: `[To write: ${text}]`, italics: true, color: "808080" }));
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
const bullet = (text) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60 }, alignment: AlignmentType.JUSTIFIED, children: runs(text) });
const lead = (title, text) => bullet([new TextRun({ text: `${title}. `, bold: true }), text]);
const caption = (text) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200 }, children: [new TextRun({ text, italics: true, size: 20 })] });
const formula = (text) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 120 }, children: [new TextRun({ text, italics: true })] });

const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };
const table = (widths, rows) => new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  columnWidths: widths,
  rows: rows.map((cells, r) => new TableRow({
    tableHeader: r === 0,
    children: cells.map((c, i) => new TableCell({
      borders, width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: r === 0 ? { type: ShadingType.CLEAR, fill: "E7E6E6", color: "auto" } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text: String(c), bold: r === 0, size: 19 })] })],
    })),
  })),
});

const pct = (x) => (x === null || Number.isNaN(x) ? "n/a" : `${(x * 100).toFixed(1)}%`);
const LABELS = { always_up: "Always up (baseline)", sma_trend: "SMA 20/50 (baseline)", logistic: "Logistic regression", mlp: "Neural network (MLP)", random_forest: "Random forest", gradient_boosting: "Gradient boosting", xgboost: "XGBoost", lstm: "LSTM", gru: "GRU" };

const load = (type) => {
  const file = path.join(reportsDir, `evaluation_${type}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};

let tableNo = 2;
const resultsSection = (type, r) => {
  if (!r) {
    return [h2(`${type === "stock" ? "Stocks" : "Cryptocurrencies"}`), todo(`${type} results: run the evaluation once ${type === "stock" ? "the Alpha Vantage key is configured" : "data is available"}`)];
  }
  const sel = r.results[r.selected_model].metrics;
  const rows = [["Model", "Accuracy", "Bal. acc.", "AUC (95% CI)", "Brier", "CAGR", "Sharpe", "Max DD", "In market"]];
  for (const [name, res] of Object.entries(r.results)) {
    const m = res.metrics, b = res.backtest_avg;
    rows.push([LABELS[name] + (name === r.selected_model ? " *" : ""), pct(m.accuracy), pct(m.balanced_accuracy),
      `${m.auc.toFixed(3)} (${m.auc_ci95[0].toFixed(3)}–${m.auc_ci95[1].toFixed(3)})`, m.brier.toFixed(4),
      pct(b.cagr), b.sharpe.toFixed(2), pct(b.max_drawdown), pct(b.exposure)]);
  }
  const bh = r.buy_and_hold_avg;
  rows.push(["Buy and hold", "—", "—", "—", "—", pct(bh.cagr), bh.sharpe.toFixed(2), pct(bh.max_drawdown), "100%"]);
  const perAsset = [["Asset", "Accuracy", "Strategy return", "Buy-and-hold return", "Strategy max DD", "B&H max DD", "Trades"]];
  for (const [symbol, a] of Object.entries(r.results[r.selected_model].per_asset)) {
    perAsset.push([symbol, pct(a.accuracy), pct(a.strategy.total_return), pct(a.buy_and_hold.total_return), pct(a.strategy.max_drawdown), pct(a.buy_and_hold.max_drawdown), a.strategy.trades]);
  }
  const t1 = ++tableNo, t2 = ++tableNo;
  const title = type === "stock" ? "Stocks" : "Cryptocurrencies";
  return [
    h2(title),
    p(`Assets: ${r.assets.join(", ")}. Out-of-sample period ${r.test_period.from} to ${r.test_period.to}. ` +
      `${pct(r.results.always_up.metrics.up_rate)} of 5-day windows closed higher. ` +
      `Selected model: ${LABELS[r.selected_model]} (lowest Brier score), AUC ${sel.auc.toFixed(3)} with 95% interval ` +
      `${sel.auc_ci95[0].toFixed(3)}–${sel.auc_ci95[1].toFixed(3)}. ` +
      (r.has_reliable_edge
        ? "The interval excludes 0.5 and its Brier score beats the always-up baseline, indicating a small but measurable edge."
        : "The interval includes 0.5 or the Brier score does not beat the always-up baseline, so no reliable predictive edge is claimed.")),
    table([2050, 820, 820, 1500, 760, 760, 700, 820, 796], rows),
    caption(`Table ${t1}. Walk-forward results, ${title.toLowerCase()} (* = selected; backtest figures are equal-weighted averages across assets)`),
    table([1300, 1100, 1450, 1550, 1300, 1200, 1126], perAsset),
    caption(`Table ${t2}. Per-asset results of the selected model, ${title.toLowerCase()}`),
  ];
};

const crypto = load("crypto");
const stock = load("stock");

const RANGE_LABELS = { constant: "Constant (baseline)", hist_vol: "Historical volatility", garch: "GARCH(1,1)", gbm_quantile: "Quantile gradient boosting", xgb_quantile: "Quantile XGBoost", lstm_quantile: "Quantile LSTM" };
const loadRange = (type) => {
  const file = path.join(reportsDir, `range_${type}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const signedPct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
function rangeSection() {
  const out = [
    h1("7. Range Forecasts"),
    p("Because direction showed no edge, the main forecast was changed to an 80% interval for the close in five trading days. Volatility is known to cluster and mean-revert, so the size of moves is expected to be far more predictable than their sign. Each model predicts the 10th and 90th percentiles of the five-day log return. The baselines are a constant range (training-set percentiles) and a 20-day historical-volatility range; the classic finance model is GARCH(1,1), fitted per asset by maximum likelihood with SciPy and refitted at every fold on data before the test window. The machine-learning models (quantile gradient boosting, quantile XGBoost and a quantile LSTM) learn the percentiles of the return divided by its 20-day volatility, so a single pooled model can serve assets with very different volatility."),
    p("Forecasts are evaluated on the same purged walk-forward folds as the direction models. Coverage measures calibration: an 80% interval should contain the actual close about 80% of the time. The interval (Winkler) score, the width plus 2/α times any miss distance with α = 0.2, is a proper scoring rule that rewards intervals that are both narrow and calibrated; the model with the lowest score is selected. Skill is the relative reduction in interval score versus the constant range, with a 95% block-bootstrap interval over test windows."),
    formula("IS = (u − l) + (2/α)·max(l − y, 0) + (2/α)·max(y − u, 0)"),
  ];
  for (const type of ["stock", "crypto"]) {
    const r = loadRange(type);
    if (!r) continue;
    const rows = [["Model", "Coverage", "Avg. width", "Interval score", "Skill vs constant (95% CI)"]];
    for (const [name, v] of Object.entries(r.results)) {
      const m = v.metrics;
      rows.push([RANGE_LABELS[name] + (name === r.selected_model ? " *" : ""), pct(m.coverage), `${m.mean_width_pct.toFixed(1)}%`, m.interval_score.toFixed(4),
        `${signedPct(m.skill_vs_constant)} (${signedPct(m.skill_vs_constant_ci95[0])} to ${signedPct(m.skill_vs_constant_ci95[1])})`]);
    }
    out.push(h2(type === "stock" ? "7.1 Stocks" : "7.2 Cryptocurrencies"));
    out.push(table([2600, 1300, 1300, 1500, 2326], rows));
    out.push(caption(`Table ${++tableNo}. ${type === "stock" ? "Stock" : "Cryptocurrency"} range forecasts, ${r.test_period.from} to ${r.test_period.to} (* = selected)`));
  }
  out.push(h2("7.3 Discussion"));
  out.push(p("Unlike direction, range forecasts show reliable skill on both markets. For stocks, every volatility-aware model beat the constant range, and the machine-learning models also beat the classic 20-day volatility method by about two percentage points; quantile gradient boosting was selected with 81% coverage. For cryptocurrencies, the 20-day method was worse than a constant range, whereas GARCH(1,1) gave the best score: crypto volatility spikes decay quickly, and GARCH models that decay towards the long-run level explicitly. The quantile LSTM again did not outperform simpler models. The finding complements Section 6: past prices say little about where a price will go, but a good deal about how far it is likely to move."));
  return out;
}


const children = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: "FinSight ML: Forecasting Short-Term Price Direction with Walk-Forward Evaluation", bold: true, size: 32 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
    children: [new TextRun({ text: "Machine-learning working document for the FinSight research paper. Sections are written to be merged into the main paper (Methodology, Implementation, Results).", italics: true, size: 20 })] }),

  h1("1. Objective"),
  p("The ML component estimates, for each asset, the probability that its closing price will be higher five trading days from now. It turns that probability into an advisory (buy, hold, sell, watch or high risk) that FinSight users see together with a confidence value and a plain-language rationale. A further objective is methodological: to measure as rigorously as possible whether such a prediction has any real out-of-sample value. The efficient-market hypothesis predicts that past prices of liquid assets contain little exploitable information, so an honest null result is treated as a valid outcome, not a failure."),

  h1("2. Data"),
  table([1700, 3500, 3826], [
    ["Asset type", "Source", "Notes"],
    ["10 NSE large caps", "Yahoo Finance daily history (NSE tickers) via the open-source yfinance library", "Split-adjusted; from 2007-01-01; zero-volume closure rows removed (Section 2.1)"],
    ["5 cryptocurrencies", "Binance public klines, USDT pairs, daily", "History from 2017 (SOL from 2020); the still-forming current-day candle is excluded"],
  ]),
  caption("Table 1. Data sources"),
  h2("2.1 Cleaning"),
  p("Duplicate dates and inconsistent rows (non-positive prices, high below low) are removed. For stocks, a scan for one-day moves above 25% found bad ticks before 2007 (for example RELIANCE rising 4.4-fold on 28 July 2005 and falling back the next day) and prices for TCS from before its 2004 listing, whereas every large move after 2007 matched a real market event. Stock history therefore starts on 1 January 2007 (about 4,890 trading days per stock). Zero-volume rows, which Yahoo uses as placeholders for exchange closures, are removed, as is the still-forming current-day candle while NSE is open. Prices are split-adjusted but not dividend-adjusted. Stocks were first sourced from Alpha Vantage, whose free series is not adjusted for corporate actions, a 1:1 bonus issue would appear as a 50% crash. An overnight gap is treated as a split when the ratio of the open to the previous close is within 3% of 1/k for k ∈ {2, 3, 4, 5, 10}. All earlier prices are then divided by k and volumes multiplied by k. Unit tests check that splits are corrected and that an ordinary 20% fall is left alone. This correction is kept, but it is no longer needed after Alpha Vantage moved full history to a paid plan and the source was changed to Yahoo Finance, whose prices are already split-adjusted."),

  h1("3. Features and Target"),
  p("Nineteen technical indicators are computed per asset from daily OHLCV data. All are scale-free (returns, ratios or z-scores), so a single model can be trained on assets with very different price levels."),
  table([2000, 7026], [
    ["Group", "Features"],
    ["Momentum", "Log returns over 1, 5, 10 and 20 days; RSI-14 (Wilder); MACD histogram ÷ price"],
    ["Trend", "Close ÷ SMA10, SMA20, SMA50, SMA200 − 1; SMA20 ÷ SMA50 − 1; position within the 52-week range"],
    ["Volatility", "Standard deviation of daily returns over 10 and 20 days and their ratio; ATR-14 ÷ price; daily range ÷ price; Bollinger %B"],
    ["Volume", "20-day z-score of log volume"],
  ]),
  caption("Table 2. Feature set"),
  p("The target for day t is y_t = 1 if close_{t+5} > close_t, else 0. A 252-day warm-up period is discarded so that every indicator is fully formed. Every feature at day t depends only on data up to day t. This is enforced by a test that multiplies all prices after t by three and asserts that no earlier feature changes."),

  h1("4. Models"),
  p("One pooled model is trained per asset type: stocks and cryptocurrencies differ in volatility and trading calendar (252 versus 365 days a year). Pooling gives about 14,000 labelled crypto rows rather than about 3,000 per coin, which reduces over-fitting. Seven candidate models from four families (linear, tree ensemble, feed-forward and recurrent neural networks) are compared with two baselines."),
  lead("Logistic regression", "Standardised features with strong L2 regularisation (C = 0.05). It is interpretable and robust to noisy, correlated inputs."),
  lead("Multilayer perceptron", "Two hidden layers (32 and 16 units) with weight decay 0.01 and early stopping on a 15% validation split. It can represent non-linear interactions between indicators."),
  lead("Always-up baseline", "Predicts the training-set share of rising windows. Because markets drift upward, this is a stronger benchmark than 50%."),
  lead("SMA 20/50 trend baseline", "Up if the 20-day moving average is above the 50-day average. This is a classic trend rule and the logic of the backend's rule-based advisories."),
  lead("Random forest", "300 trees of depth at most 6 with at least 200 samples per leaf, so each leaf averages many days and cannot memorise noise."),
  lead("Gradient boosting", "Histogram-based boosting with depth-3 trees, learning rate 0.03, 150 iterations and L2 regularisation."),
  lead("XGBoost", "Extreme gradient boosting with 300 depth-3 trees, learning rate 0.03, 80% row and column subsampling and a minimum child weight equivalent to about 200 rows per leaf."),
  lead("LSTM and GRU", "Recurrent networks (PyTorch) that read the last 30 trading days of the 19 standardised indicators rather than a single day. One recurrent layer of 16 units, dropout 0.2, AdamW weight decay 1e-3 and early stopping on the most recent 15% of training dates (a time-ordered split). Windows use only the same asset's past rows, which a unit test verifies, and every model is scored on identical rows and folds."),
  p("Tree ensembles (including XGBoost) and the recurrent networks were added after the first experiments. Initially their compiled libraries were blocked by Windows Smart App Control on the development machine; the generic fit/predict interface meant no change to the evaluation code was needed once that restriction was lifted."),

  h1("5. Evaluation Methodology"),
  h2("5.1 Walk-forward validation with purging"),
  p("Models are evaluated with an expanding-window walk-forward scheme. The first test window starts after 500 trading days of history. Each window covers the next 63 trading days (about one quarter), and the models are retrained from scratch on all earlier data before every window. Random train/test splits are unsuitable for time series because they leak information from the future into training. Because each label depends on prices five days ahead, a training row is used only if its outcome date falls before the test window begins (purging). Otherwise the final training labels would be computed from prices inside the test window."),
  h2("5.2 Metrics and uncertainty"),
  p("Out-of-sample predictions are scored with accuracy, balanced accuracy, ROC AUC and the Brier score:"),
  formula("Brier = (1/N) Σ (p_i − y_i)²"),
  p("The Brier score is a proper scoring rule, minimised by probabilities that are both informative and well calibrated. A constant 50% forecast scores 0.25. Uncertainty in AUC is estimated with a 95% block bootstrap that resamples entire 63-day test windows 500 times. Resampling individual days would understate uncertainty, because neighbouring days share overlapping five-day outcomes."),
  h2("5.3 Model selection and edge criterion"),
  p("The candidate with the lowest Brier score is selected, because its probability is shown to users as confidence. A model is said to have a reliable edge only if (i) the lower bound of its AUC interval exceeds 0.5 and (ii) its Brier score is no worse than the always-up baseline. In the crypto experiments, the neural network had the highest AUC (0.514) but a Brier score (0.261) worse than the constant baseline (0.2505), indicating over-confidence. The better-calibrated logistic regression was therefore selected. In the final six-model comparison, the random forest was selected for stocks and the LSTM for cryptocurrencies, in both cases by margins far smaller than the uncertainty in the scores."),
  h2("5.4 Trading backtest"),
  p("Predictions are also tested as a long-or-cash strategy that uses the same thresholds as the advisories: enter on a buy signal (P(up) ≥ 0.55), exit on a sell signal (P(up) ≤ 0.45), and otherwise keep the current position. The position chosen at day t's close earns the return from t to t + 1. A 0.1% cost is charged on each change of position. Total return, compound annual growth rate (CAGR), Sharpe ratio, maximum drawdown and time in the market are compared with buy-and-hold over the same period."),

  h1("6. Results"),
  ...resultsSection("crypto", crypto),
  ...resultsSection("stock", stock),
  h2("Discussion"),
  p(crypto
    ? `For cryptocurrencies, no candidate achieved a statistically reliable edge in predicting five-day direction from price-based technical indicators. The selected model's AUC interval (${crypto.results[crypto.selected_model].metrics.auc_ci95[0].toFixed(3)}–${crypto.results[crypto.selected_model].metrics.auc_ci95[1].toFixed(3)}) contains the 0.5 chance level. The model-timed strategy also trailed buy-and-hold on return (CAGR ${pct(crypto.results[crypto.selected_model].backtest_avg.cagr)} versus ${pct(crypto.buy_and_hold_avg.cagr)}), with comparable drawdowns. This is consistent with weak-form market efficiency in highly liquid markets. It also shows why rigorous evaluation matters: without purging, block-bootstrap intervals and calibrated selection, the neural network's slightly higher accuracy could easily have been reported as a predictive success.`
    : "Results pending."),
  p(stock
    ? `The stock results agree. For ten NSE large caps, the selected model's AUC interval (${stock.results[stock.selected_model].metrics.auc_ci95[0].toFixed(3)}–${stock.results[stock.selected_model].metrics.auc_ci95[1].toFixed(3)}) again contains 0.5, and its Brier score (${stock.results[stock.selected_model].metrics.brier.toFixed(4)}) does not beat the constant always-up forecast (${stock.results.always_up.metrics.brier.toFixed(4)}). Stocks rose in ${pct(stock.results.always_up.metrics.up_rate)} of five-day windows, and that upward drift makes the base rate hard to beat. The model-timed strategy stayed invested ${pct(stock.results[stock.selected_model].backtest_avg.exposure)} of the time and returned ${pct(stock.results[stock.selected_model].backtest_avg.cagr)} a year against ${pct(stock.buy_and_hold_avg.cagr)} for buy-and-hold, so it behaved as a slightly worse buy-and-hold. Two asset classes with very different volatility, trading hours and investor bases give the same null result. That supports the weak-form-efficiency interpretation, and it shows that the evaluation framework is not biased towards finding an edge. The result also holds across model families: linear, tree-ensemble (random forest, gradient boosting, XGBoost), feed-forward and recurrent (LSTM, GRU) models all score an AUC close to 0.5, so the absence of an edge is not an artefact of choosing too simple a model.`
    : "Stock results pending."),

  ...rangeSection(),
  h1("8. From Prediction to Advisory"),
  table([2200, 6826], [
    ["Signal", "Rule (p = P(close higher in 5 trading days))"],
    ["high_risk", "Annualised 30-day volatility ≥ 85% (overrides the model)"],
    ["buy", "p ≥ 0.55"],
    ["sell", "p ≤ 0.45"],
    ["watch", "0.52 ≤ p < 0.55 or 0.45 < p ≤ 0.48 (leaning, close to a threshold)"],
    ["hold", "otherwise: no clear edge, keep the current position"],
  ]),
  caption(`Table ${++tableNo}. Signal mapping`),
  p("Confidence is max(p, 1 − p) and the risk score is the annualised volatility capped at 1. Each advisory's rationale states the model's probability, key indicator values, and the model's walk-forward accuracy and AUC, so users can see how reliable it has been. Advisories reach the backend through its authenticated ingestion API. The pipeline first replaces each asset's price history with the real data in a single transaction, then upserts the day's advisories, which supersede the rule-based baseline. The chat assistant then explains them to users."),

  h1("9. Implementation and Testing"),
  p("The pipeline is a Python package (finsight_ml) with a command-line interface (fetch, evaluate, train, predict, publish, all). Because Smart App Control blocked pandas when the pipeline was designed (pandas is now used only inside the yfinance download step), it is built on numpy, scipy, scikit-learn and PyTorch (CPU) for the recurrent models. Versions are pinned and random seeds fixed. Twenty-nine unit tests cover the absence of look-ahead, target construction, walk-forward purging, baselines, a planted-signal sanity check, the bootstrap interval on pure noise, signal mapping, the backtest arithmetic (including a drawdown bug found and fixed during testing), data cleaning, stock-history trimming, partial-candle handling, look-ahead-free sequence windows, planted-signal checks for the tree and recurrent models, GARCH parameter recovery and look-ahead, and the calibration and scoring of range forecasts. A full evaluation of all eight models (66 stock folds and 42 crypto folds) takes about 70 minutes on a CPU, dominated by the LSTM and GRU."),

  h1("10. Limitations and Future Work"),
  bullet("Range forecasts are per asset; a portfolio-level range would need a model of the correlations between assets."),
  bullet("Only price and volume features are used. News sentiment (already stored by the backend), market-wide factors and fundamentals may add information."),
  bullet("The recurrent networks were kept small for CPU training; larger architectures or attention-based models were not tested, although the null result across six model families makes a large gain unlikely with price-only inputs."),
  bullet("Probabilities are not explicitly calibrated (e.g. Platt or isotonic scaling)."),
  bullet("Stock prices are not dividend-adjusted. Stock data comes from an unofficial Yahoo Finance interface with no service guarantee; a licensed feed would be needed in production."),
  bullet("Results cover one five-day horizon and fixed thresholds. Tuning thresholds on the same data would risk over-fitting and was deliberately avoided."),
  bullet("Longer horizons (20 or 60 days) and market-wide features (NIFTY 50, BTC dominance) remain to be tested."),

  h1("Appendix A. ML Development Log"),
  bullet("13 Nov 2026: Chose 5-day direction as the target, Alpha Vantage (stocks) and Binance (crypto) as data sources, and numpy/scikit-learn because Smart App Control blocks pandas and tree models."),
  bullet("13 Nov 2026: Implemented data fetching with split adjustment, 19 technical features with a no-look-ahead test, logistic-regression and MLP models with two baselines, purged walk-forward evaluation, a cost-aware backtest, and signal mapping."),
  bullet("13 Nov 2026: First crypto evaluation selected the MLP by AUC; changed selection to the Brier score after finding the MLP over-confident, and added block-bootstrap AUC intervals. Fixed a maximum-drawdown bug found by unit tests."),
  bullet("13 Nov 2026: Published real Binance prices and ML advisories to the backend (added replace mode to price ingestion); the chat assistant now explains ML signals."),
  bullet("13 Nov 2026: Switched stock data to Yahoo Finance (yfinance, NSE tickers) after Alpha Vantage moved full history to a paid plan. A data-quality scan led to starting stock history in 2007 and dropping zero-volume closure rows. Stock walk-forward evaluation (2010–2026): no reliable edge (AUC 0.495, CI 0.481–0.508), the same as crypto. Published real NSE prices and stock advisories to the backend."),
  bullet("13 Nov 2026: Added random forest, gradient boosting, LSTM and GRU (PyTorch) as candidates after Smart App Control was turned off, with 30-day look-ahead-free input windows and time-ordered early stopping. No model family found a reliable edge on either asset class. Random forest (stocks) and LSTM (crypto) were selected by Brier score, retrained and published."),
  bullet("13 Nov 2026: Added XGBoost as a seventh candidate, evaluated on its own and merged into the saved results (recomputed baselines matched exactly). AUC 0.505 (stocks) and 0.511 (crypto); no edge, and the selected models were unchanged."),
  bullet("13 Nov 2026: Made an 80% price range for the close in five trading days the main forecast. Range models showed reliable skill over a constant range on both markets (stocks: quantile gradient boosting, +5.4%; crypto: GARCH(1,1), +3.1%; both 95% intervals exclude zero). Ranges were added to the backend advisories and shown as a range bar and a forecast cone in the app."),
];

const doc = new Document({
  creator: "FinSight",
  title: "FinSight ML Research Notes",
  styles: {
    default: { document: { run: { font: FONT, size: 24 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 28, bold: true }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 24, bold: true, italics: true }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•",
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log("wrote", out); });
