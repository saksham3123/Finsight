import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { FaMagnifyingGlass, FaRegStar, FaStar } from "react-icons/fa6";
import { PageTitle } from "../components/layout/Layout";
import TrendChart from "../components/charts/TrendChart";
import ChartHint from "../components/charts/ChartHint";
import ActionBadge from "../components/ui/ActionBadge";
import RangeBar from "../components/ui/RangeBar";
import Button from "../components/ui/Button";
import { Field } from "../components/ui/Form";
import { Change, ErrorState, Panel, Segmented, Skeleton } from "../components/ui/Feedback";
import useAsync from "../hooks/useAsync";
import { getAssetDetail, getAssets, getHistory } from "../services/marketService";
import { addToWatchlist, getPortfolio, getWatchlist, removeFromWatchlist, trade } from "../services/portfolioService";
import { formatDate, formatMoney, formatMoneyCompact, formatPct, formatQuantity } from "../utils/format";
import { describeRange, RANGES } from "../utils/ranges";
import { chartForecast, hasRange } from "../utils/forecast";

const COPY = {
  stock: { title: "Stocks", subtitle: "NSE large caps, priced in INR. Daily closes from Yahoo Finance.", base: "/stocks", search: "Search stocks" },
  crypto: { title: "Crypto", subtitle: "Major coins, priced in USD (Binance USDT pairs). Daily closes.", base: "/crypto", search: "Search coins" },
};

function QuoteList({ quotes, selected, base, searchLabel }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? quotes.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) : quotes;
  }, [quotes, query]);

  return (
    <Panel className="lg:sticky lg:top-24">
      <div className="border-b border-line p-3">
        <label className="relative block">
          <span className="sr-only">{searchLabel}</span>
          <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchLabel}
            className="w-full rounded-lg border border-line bg-surface-2 py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-series-1"
          />
        </label>
      </div>
      <ul className="max-h-[560px] overflow-y-auto">
        {filtered.map((q) => (
          <li key={q.id}>
            <Link
              to={`${base}/${q.symbol}`}
              aria-current={q.symbol === selected ? "page" : undefined}
              className={`flex items-center justify-between gap-3 border-l-2 px-4 py-3 transition-colors ${
                q.symbol === selected ? "border-series-1 bg-surface-2" : "border-transparent hover:bg-surface-2"
              }`}
            >
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{q.symbol}</span>
                <span className="block truncate text-xs text-muted">{q.name}</span>
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums">
                {q.latestPrice == null ? (
                  <span className="block text-muted">No price</span>
                ) : (
                  <>
                    <span className="block text-ink">{formatMoney(q.latestPrice, q.currency)}</span>
                    {q.changePct != null && <Change value={q.changePct} className="text-xs" />}
                  </>
                )}
              </span>
            </Link>
          </li>
        ))}
        {filtered.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No matches for “{query}”.</li>}
      </ul>
    </Panel>
  );
}

function PriceChart({ quote, advisory }) {
  const [range, setRange] = useState("6M");
  const { data, loading, error, reload } = useAsync(() => getHistory(quote.id, range), [quote.id, range]);

  const stats = useMemo(() => {
    if (!data?.length) return null;
    const prices = data.map((d) => d.price);
    const first = prices[0];
    const last = prices[prices.length - 1];
    return { high: Math.max(...prices), low: Math.min(...prices), ret: ((last - first) / first) * 100 };
  }, [data]);

  // The cone starts at the last close, so only draw it when the chart ends on that close.
  const lastDate = data?.[data.length - 1]?.date;
  const forecast = lastDate === quote.priceDate ? chartForecast(advisory, lastDate, quote.assetType) : null;

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <p className="text-xs text-muted">{stats ? `Return over ${describeRange(range)}` : " "}</p>
        <Segmented label="Time range" options={Object.keys(RANGES)} value={range} onChange={setRange} />
      </div>
      <div className="p-5">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data ? (
          <Skeleton className="h-[360px]" />
        ) : data.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">No price history for this range.</p>
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <TrendChart
              data={data}
              series={[{ key: "price", label: `${quote.symbol} close`, color: "var(--series-1)" }]}
              formatValue={(v) => formatMoney(v, quote.currency)}
              formatAxis={(v) => formatMoneyCompact(v, quote.currency)}
              formatLabel={(d) => formatDate(d, true)}
              height={340}
              forecast={forecast}
              caption={forecast ? `Dashed band: the model's ${forecast.label} for the close over the next ${forecast.dates.length} trading days.` : undefined}
              overlay={
                <ChartHint>
                  Hover over the chart (or tap it on a phone) to see the closing price for any day. Switch the range with the
                  buttons above, or open <strong className="text-ink">Table</strong> to read every value.
                </ChartHint>
              }
            />
          </div>
        )}
      </div>
      {stats && (
        <dl className="grid grid-cols-3 border-t border-line text-sm">
          {[
            ["Period high", formatMoney(stats.high, quote.currency)],
            ["Period low", formatMoney(stats.low, quote.currency)],
            ["Period return", <Change key="r" value={stats.ret} />],
          ].map(([label, value]) => (
            <div key={label} className="border-r border-line px-5 py-4 last:border-r-0">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-1 font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

/**
 * The latest advisory: the range forecast first (it has measurable out-of-sample skill), then the
 * direction signal, labelled as unproven, and 7-day news sentiment.
 */
function AdvisoryPanel({ detail, quote }) {
  const { data, error, reload } = detail;
  const advisory = data?.latestAdvisory;
  return (
    <Panel title="Forecast">
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5" />)}</div>
      ) : !advisory ? (
        <p className="p-5 text-sm text-muted">No advisory has been generated for this asset yet.</p>
      ) : (
        <div className="p-5">
          {hasRange(advisory) && (
            <div className="mb-4 rounded-lg border border-line p-4">
              <RangeBar low={advisory.priceLow} high={advisory.priceHigh} current={quote.latestPrice} currency={quote.currency}
                level={advisory.rangeLevel} horizonDays={advisory.horizonDays} />
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted">Direction signal · no proven edge</span>
            <ActionBadge signal={advisory.signal} />
          </div>
          <p className="text-sm leading-relaxed text-ink-2">{advisory.rationale}</p>
          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-xs">
            <div>
              <dt className="text-muted">Confidence</dt>
              <dd className="mt-0.5 font-semibold text-ink">{advisory.confidence != null ? `${Math.round(advisory.confidence * 100)}%` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Risk score</dt>
              <dd className="mt-0.5 font-semibold text-ink">{advisory.riskScore != null ? `${Math.round(advisory.riskScore * 100)}%` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">News (7 days)</dt>
              <dd className="mt-0.5 font-semibold text-ink">
                {data.sentiment7d?.articles ? `${data.sentiment7d.average > 0 ? "+" : ""}${data.sentiment7d.average} · ${data.sentiment7d.articles} articles` : "No articles"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] text-muted">
            {formatDate(advisory.advisoryDate, true)} · {advisory.rangeModelVersion ? `${advisory.rangeModelVersion} · ` : ""}
            {advisory.modelVersion ?? "baseline"} · Research prototype, not financial advice.
          </p>
        </div>
      )}
    </Panel>
  );
}

/** Market-order buy/sell at the latest close (the backend fills the price). */
function TradePanel({ quote }) {
  const [side, setSide] = useState("Buy");
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const portfolio = useAsync(getPortfolio);
  const held = portfolio.data?.holdings.find((h) => h.assetId === quote.id)?.quantity ?? 0;
  const qty = Number(quantity);
  const valid = quantity !== "" && qty > 0 && Number.isFinite(qty);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await trade(quote.id, side.toLowerCase(), quantity);
      const t = res.transaction;
      const pnl = res.realizedPnl != null && side === "Sell" ? ` Realised P&L ${formatMoney(res.realizedPnl, quote.currency)}.` : "";
      setMessage({ ok: true, text: `${side === "Buy" ? "Bought" : "Sold"} ${formatQuantity(t.quantity)} ${quote.symbol} at ${formatMoney(t.price, quote.currency)}.${pnl}` });
      setQuantity("");
      portfolio.reload();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  if (quote.latestPrice == null) return null;
  return (
    <Panel title="Trade" action={<Segmented label="Order side" options={["Buy", "Sell"]} value={side} onChange={setSide} />}>
      <form onSubmit={onSubmit} className="space-y-4 p-5">
        <Field
          id="trade-qty"
          label="Quantity"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          hint={`You hold ${formatQuantity(held)} ${quote.symbol}.`}
          required
        />
        <div className="flex justify-between text-sm">
          <span className="text-ink-2">Estimated {side === "Buy" ? "cost" : "proceeds"}</span>
          <span className="font-semibold text-ink">{formatMoney(valid ? qty * quote.latestPrice : 0, quote.currency)}</span>
        </div>
        <Button type="submit" className="w-full" disabled={!valid || busy}>
          {busy ? "Placing order…" : `${side} ${quote.symbol}`}
        </Button>
        <p className="text-[11px] text-muted">Paper trading: orders fill at the latest daily close ({formatDate(quote.priceDate, true)}).</p>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? "text-good-ink" : "text-bad-ink"}`}>
            {message.text}
          </p>
        )}
      </form>
    </Panel>
  );
}

function WatchButton({ assetId, watched, onChange }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await (watched ? removeFromWatchlist(assetId) : addToWatchlist(assetId));
      onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" onClick={toggle} disabled={busy} aria-pressed={watched}>
      {watched ? <FaStar className="text-warn" aria-hidden="true" /> : <FaRegStar aria-hidden="true" />}
      {watched ? "Watching" : "Watch"}
    </Button>
  );
}

function QuoteDetail({ quote, watched, onWatchChange }) {
  const detail = useAsync(() => getAssetDetail(quote.id), [quote.id]);
  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <p className="text-sm text-muted">
              {quote.symbol} · {quote.exchange ?? quote.assetType} · {quote.currency}
            </p>
            <h2 className="text-xl font-bold text-ink">{quote.name}</h2>
            {quote.latestPrice != null && (
              <p className="mt-2 flex flex-wrap items-baseline gap-3">
                <span className="text-3xl font-bold tracking-tight text-ink">{formatMoney(quote.latestPrice, quote.currency)}</span>
                {quote.changePct != null && <Change value={quote.changePct}>{formatPct(quote.changePct)} on the day</Change>}
                <span className="text-xs text-muted">Close of {formatDate(quote.priceDate, true)}</span>
              </p>
            )}
          </div>
          <WatchButton assetId={quote.id} watched={watched} onChange={onWatchChange} />
        </div>
        <PriceChart quote={quote} advisory={detail.data?.latestAdvisory} />
      </Panel>
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_340px]">
        <AdvisoryPanel detail={detail} quote={quote} />
        <TradePanel key={quote.id} quote={quote} />
      </div>
    </div>
  );
}

/** Stocks and Crypto pages: a searchable list with a detail view for the selected symbol. */
export default function Markets({ type }) {
  const copy = COPY[type];
  const { symbol } = useParams();
  const { data: quotes, error, reload } = useAsync(() => getAssets(type), [type]);
  const watchlist = useAsync(getWatchlist);

  if (quotes?.length && !symbol) return <Navigate to={`${copy.base}/${quotes[0].symbol}`} replace />;
  const selected = quotes?.find((q) => q.symbol === symbol?.toUpperCase());
  const watched = Boolean(selected && watchlist.data?.some((w) => w.id === selected.id));

  return (
    <>
      <PageTitle title={copy.title} subtitle={copy.subtitle} />
      {error ? (
        <Panel><ErrorState error={error} onRetry={reload} /></Panel>
      ) : !quotes ? (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-[480px]" />
          <Skeleton className="h-[480px]" />
        </div>
      ) : quotes.length === 0 ? (
        <Panel><p className="p-6 text-sm text-ink-2">No {copy.title.toLowerCase()} are set up yet. Run the backend seed.</p></Panel>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
          <QuoteList quotes={quotes} selected={selected?.symbol} base={copy.base} searchLabel={copy.search} />
          {selected ? (
            <QuoteDetail key={selected.id} quote={selected} watched={watched} onWatchChange={watchlist.reload} />
          ) : (
            <Panel>
              <p className="p-6 text-sm text-ink-2">
                “{symbol}” isn&apos;t in the list. Pick a symbol on the left.
              </p>
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
