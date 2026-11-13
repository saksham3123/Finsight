import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageTitle } from "../components/layout/Layout";
import TrendChart from "../components/charts/TrendChart";
import ActionBadge from "../components/ui/ActionBadge";
import RangeBar from "../components/ui/RangeBar";
import Button from "../components/ui/Button";
import { Change, ErrorState, Panel, Segmented, Skeleton } from "../components/ui/Feedback";
import useAsync from "../hooks/useAsync";
import { getAdvisories, getAssets } from "../services/marketService";
import { getPerformance, getPortfolio, getWatchlist } from "../services/portfolioService";
import { formatDate, formatMoney, formatMoneyCompact, formatPct, formatQuantity, formatSignedMoney } from "../utils/format";
import { describeRange, RANGES } from "../utils/ranges";
import { hasRange } from "../utils/forecast";

const assetPath = (a) => `/${a.assetType === "crypto" ? "crypto" : "stocks"}/${a.symbol}`;
const CURRENCY_LABEL = { INR: "Stocks (INR)", USD: "Crypto (USD)" };

function StatCard({ label, value, delta, loading }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-32" />
      ) : (
        <>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{value}</p>
          {delta && <p className="mt-1 text-sm">{delta}</p>}
        </>
      )}
    </div>
  );
}

/**
 * One row of headline numbers per currency: INR stocks and USD crypto can't be added
 * together without an exchange rate. "Today" uses each asset's previous close.
 */
function Stats({ portfolio, quotes }) {
  const rows = portfolio.totals.map((t) => {
    const dayChange = portfolio.holdings
      .filter((h) => h.currency === t.currency)
      .reduce((sum, h) => {
        const prev = quotes?.[h.assetId]?.previousClose;
        return prev == null || h.latestPrice == null ? sum : sum + h.quantity * (h.latestPrice - prev);
      }, 0);
    const start = t.marketValue - dayChange;
    return { ...t, dayChange, dayChangePct: start ? (dayChange / start) * 100 : 0 };
  });

  return rows.map((t) => (
    <div key={t.currency}>
      {rows.length > 1 && <h2 className="mb-2 text-sm font-semibold text-ink-2">{CURRENCY_LABEL[t.currency] ?? t.currency}</h2>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Portfolio value" value={formatMoney(t.marketValue ?? 0, t.currency, { whole: true })} />
        <StatCard label="Invested" value={formatMoney(t.costBasis, t.currency, { whole: true })}
          delta={<span className="text-muted">{t.positions} {t.positions === 1 ? "holding" : "holdings"}</span>} />
        <StatCard label="Total returns" value={formatSignedMoney(t.unrealizedPnl ?? 0, t.currency, { whole: true })}
          delta={<Change value={t.unrealizedPnlPct ?? 0} />} />
        <StatCard label="Today" loading={!quotes} value={formatSignedMoney(t.dayChange, t.currency, { whole: true })}
          delta={<Change value={t.dayChangePct} />} />
      </div>
    </div>
  ));
}

function Performance({ holdings }) {
  const currencies = [...new Set(holdings.map((h) => h.currency))];
  const [currency, setCurrency] = useState(currencies[0]);
  const [range, setRange] = useState("6M");
  const selected = useMemo(() => holdings.filter((h) => h.currency === currency), [holdings, currency]);
  const { data, loading, error, reload } = useAsync(() => getPerformance(selected, range), [selected, range]);
  const first = data?.[0]?.price;
  const last = data?.[data.length - 1]?.price;

  return (
    <Panel
      title="Overall performance"
      action={
        <div className="flex flex-wrap gap-2">
          {currencies.length > 1 && <Segmented label="Currency" options={currencies} value={currency} onChange={setCurrency} />}
          <Segmented label="Time range" options={Object.keys(RANGES)} value={range} onChange={setRange} />
        </div>
      }
    >
      <div className="p-5">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data ? (
          <Skeleton className="h-[320px]" />
        ) : data.length < 2 ? (
          <p className="py-16 text-center text-sm text-muted">Not enough price history for this range.</p>
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <p className="mb-4 text-sm text-ink-2">
              <Change value={last - first}>
                {formatSignedMoney(last - first, currency, { whole: true })} ({formatPct(((last - first) / first) * 100)})
              </Change>{" "}
              over {describeRange(range)}
            </p>
            <TrendChart
              data={data}
              series={[{ key: "price", label: "Portfolio value", color: "var(--series-1)" }]}
              formatValue={(v) => formatMoney(v, currency, { whole: true })}
              formatAxis={(v) => formatMoneyCompact(v, currency)}
              formatLabel={(d) => formatDate(d, true)}
              height={300}
              caption="Daily closing value of your current holdings at today's quantities."
            />
          </div>
        )}
      </div>
    </Panel>
  );
}

function Holdings({ holdings, quotes }) {
  return (
    <Panel title="Holdings">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-medium">Asset</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Qty</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Avg. cost</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Price</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Value</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Returns</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.assetId} className="border-t border-line hover:bg-surface-2">
                <td className="px-5 py-3">
                  <Link to={assetPath(h)} className="font-semibold text-ink hover:text-series-1">
                    {h.symbol}
                  </Link>
                  <p className="text-xs text-muted">{h.name}</p>
                </td>
                <td className="px-5 py-3 text-right text-ink-2">{formatQuantity(h.quantity)}</td>
                <td className="px-5 py-3 text-right text-ink-2">{formatMoney(h.avgBuyPrice, h.currency)}</td>
                <td className="px-5 py-3 text-right">
                  <span className="text-ink">{h.latestPrice == null ? "—" : formatMoney(h.latestPrice, h.currency)}</span>
                  {quotes?.[h.assetId]?.changePct != null && (
                    <>
                      <br />
                      <Change value={quotes[h.assetId].changePct} className="text-xs" />
                    </>
                  )}
                </td>
                <td className="px-5 py-3 text-right font-medium text-ink">
                  {h.marketValue == null ? "—" : formatMoney(h.marketValue, h.currency, { whole: true })}
                </td>
                <td className="px-5 py-3 text-right">
                  <Change value={h.unrealizedPnl ?? 0}>{formatSignedMoney(h.unrealizedPnl ?? 0, h.currency, { whole: true })}</Change>
                  <br />
                  <span className="text-xs text-muted">{formatPct(h.unrealizedPnlPct ?? 0)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Watchlist() {
  const { data, error, reload } = useAsync(getWatchlist);
  return (
    <Panel title="Watchlist">
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : data.length === 0 ? (
        <p className="p-5 text-sm text-muted">Nothing watched yet. Use the Watch button on any stock or coin.</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.map((w) => (
            <li key={w.id}>
              <Link to={assetPath(w)} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{w.symbol}</span>
                  <span className="block truncate text-xs text-muted">{w.name}</span>
                </span>
                <span className="text-right text-sm tabular-nums">
                  <span className="block text-ink">{w.latestPrice == null ? "—" : formatMoney(w.latestPrice, w.currency)}</span>
                  {w.changePct != null && <Change value={w.changePct} className="text-xs" />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Advisories for the user's holdings; with no holdings, the most confident signals overall. */
function Advisory({ holdings, quotes }) {
  const { data, error, reload } = useAsync(() => getAdvisories(), []);
  const held = new Set(holdings.map((h) => h.assetId));
  const mine = data?.filter((a) => held.has(a.assetId)) ?? [];
  const shown = mine.length ? mine : (data ?? []).slice(0, 4);

  return (
    <section aria-labelledby="advisory-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="advisory-title" className="text-base font-semibold">
          {mine.length ? "Advisory on your holdings" : "Top advisories"}
        </h2>
        <p className="text-xs text-muted">80% price ranges for the next 5 trading days · research prototype, not financial advice</p>
      </div>
      {error ? (
        <Panel><ErrorState error={error} onRetry={reload} /></Panel>
      ) : !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : shown.length === 0 ? (
        <Panel><p className="p-5 text-sm text-muted">No advisories yet. Run the ML pipeline or generate baseline advisories.</p></Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {shown.map((a) => (
            <article key={a.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link to={assetPath(a)} className="font-semibold text-ink hover:text-series-1">
                    {a.symbol}
                  </Link>
                  <p className="text-xs text-muted">{a.name}</p>
                </div>
                <ActionBadge signal={a.signal} />
              </div>
              <div className="mt-4 flex-1">
                {hasRange(a) ? (
                  <RangeBar low={a.priceLow} high={a.priceHigh} current={quotes?.[a.assetId]?.latestPrice} currency={a.currency}
                    level={a.rangeLevel} horizonDays={a.horizonDays} compact />
                ) : (
                  <p className="line-clamp-4 text-sm text-ink-2" title={a.rationale}>{a.rationale}</p>
                )}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
                <div>
                  <dt className="text-muted">Direction confidence</dt>
                  <dd className="font-semibold text-ink">{a.confidence != null ? `${Math.round(a.confidence * 100)}%` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Risk score</dt>
                  <dd className="font-semibold text-ink">{a.riskScore != null ? `${Math.round(a.riskScore * 100)}%` : "—"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyPortfolio() {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="font-semibold text-ink">Your portfolio is empty</h2>
          <p className="mt-1 text-sm text-ink-2">Buy a stock or coin to start tracking value and returns. Trades fill at the latest daily close.</p>
        </div>
        <div className="flex gap-2">
          <Button to="/stocks">Browse stocks</Button>
          <Button to="/crypto" variant="secondary">Browse crypto</Button>
        </div>
      </div>
    </Panel>
  );
}

export default function Dashboard() {
  const portfolio = useAsync(getPortfolio);
  const assets = useAsync(() => getAssets(), []);
  const quotes = useMemo(() => assets.data && Object.fromEntries(assets.data.map((a) => [a.id, a])), [assets.data]);
  const holdings = portfolio.data?.holdings ?? [];
  const priced = holdings.filter((h) => h.latestPrice != null);

  return (
    <>
      <PageTitle title="Dashboard" subtitle="Your portfolio at a glance, valued at the latest daily close." />
      <div className="space-y-6">
        {portfolio.error ? (
          <Panel><ErrorState error={portfolio.error} onRetry={portfolio.reload} /></Panel>
        ) : !portfolio.data ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <StatCard key={i} label="" loading />)}</div>
        ) : holdings.length === 0 ? (
          <EmptyPortfolio />
        ) : (
          <>
            <Stats portfolio={portfolio.data} quotes={quotes} />
            {priced.length > 0 && <Performance holdings={priced} />}
            <Holdings holdings={holdings} quotes={quotes} />
          </>
        )}
        <div className="grid items-start gap-6 xl:grid-cols-[1fr_320px]">
          <Advisory holdings={holdings} quotes={quotes} />
          <Watchlist />
        </div>
      </div>
    </>
  );
}
