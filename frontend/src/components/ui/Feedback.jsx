import { FaArrowDown, FaArrowUp, FaCircleExclamation, FaMinus } from "react-icons/fa6";
import { formatPct } from "../../utils/format";

/** Price/percentage change. Direction is shown by arrow and sign as well as colour. */
export function Change({ value, children, className = "" }) {
  const up = value > 0;
  const down = value < 0;
  const Icon = up ? FaArrowUp : down ? FaArrowDown : FaMinus;
  const tone = up ? "text-good-ink" : down ? "text-bad-ink" : "text-muted";
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${tone} ${className}`}>
      <Icon aria-hidden="true" className="text-[0.75em]" />
      {children ?? formatPct(value)}
    </span>
  );
}

/** Placeholder block shown while data loads. */
export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} aria-hidden="true" />;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 p-6 text-center">
      <FaCircleExclamation className="text-2xl text-bad" aria-hidden="true" />
      <p className="text-sm text-ink-2">Couldn&apos;t load this data: {error.message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-sm font-semibold text-series-1 hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

/** Card with an optional title row. */
export function Panel({ title, action, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Segmented control, e.g. 1W / 1M / 6M / 1Y. */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          aria-pressed={value === opt}
          onClick={() => onChange(opt)}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
            value === opt ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
