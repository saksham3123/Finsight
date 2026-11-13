import { useMemo, useState } from "react";
import { FaCalendarCheck, FaCircleDot, FaClock } from "react-icons/fa6";
import { PageTitle } from "../components/layout/Layout";
import { Change, ErrorState, Panel, Segmented, Skeleton } from "../components/ui/Feedback";
import useAsync from "../hooks/useAsync";
import { getIpos } from "../services/ipoService";
import { formatDate } from "../utils/format";

const FILTERS = ["All", "Open", "Upcoming", "Listed"];

const STATUS = {
  Open: { Icon: FaCircleDot, className: "bg-good-soft text-good-ink" },
  Upcoming: { Icon: FaClock, className: "bg-surface-2 text-ink-2" },
  Listed: { Icon: FaCalendarCheck, className: "bg-surface-2 text-ink-2" },
};

function StatusPill({ status }) {
  const { Icon, className } = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      <Icon aria-hidden="true" className="text-[0.8em]" />
      {status}
    </span>
  );
}

function IpoCard({ ipo }) {
  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">{ipo.name}</h2>
          <p className="text-xs text-muted">{ipo.sector}</p>
        </div>
        <StatusPill status={ipo.status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Price band</dt>
          <dd className="font-medium text-ink">{ipo.priceBand}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Lot size</dt>
          <dd className="font-medium text-ink">{ipo.lotSize} shares</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Bidding</dt>
          <dd className="font-medium text-ink">
            {formatDate(ipo.opens)} – {formatDate(ipo.closes)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{ipo.status === "Listed" ? "Listing gain" : "Subscribed"}</dt>
          <dd className="font-medium text-ink">
            {ipo.status === "Listed" ? (
              <Change value={ipo.listingGain} />
            ) : ipo.subscription != null ? (
              `${ipo.subscription.toFixed(1)}×`
            ) : (
              <span className="text-muted">Not yet open</span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default function Ipos() {
  const [filter, setFilter] = useState("All");
  const { data, error, reload } = useAsync(getIpos);
  const shown = useMemo(() => (data ?? []).filter((i) => filter === "All" || i.status === filter), [data, filter]);

  return (
    <>
      <PageTitle
        title="IPOs"
        subtitle="Open, upcoming and recently listed public issues. Demo data."
        action={<Segmented label="Filter IPOs" options={FILTERS} value={filter} onChange={setFilter} />}
      />
      {error ? (
        <Panel><ErrorState error={error} onRetry={reload} /></Panel>
      ) : !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-52" />)}
        </div>
      ) : shown.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((ipo) => <IpoCard key={ipo.name} ipo={ipo} />)}
        </div>
      ) : (
        <Panel><p className="p-6 text-center text-sm text-muted">No {filter.toLowerCase()} IPOs right now.</p></Panel>
      )}
    </>
  );
}
