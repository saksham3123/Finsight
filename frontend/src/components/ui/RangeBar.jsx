import { formatMoney } from "../../utils/format";

/**
 * Forecast range as a bar: low and high at the ends, the latest close marked on it.
 * The marker is clamped to the bar so a close outside the range still shows at the edge.
 */
export default function RangeBar({ low, high, current, currency, level, horizonDays, compact = false }) {
  const position = current == null || high === low ? 50 : Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100));
  const widthPct = ((high / low - 1) * 100).toFixed(1);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
        <span>
          {Math.round(level * 100)}% range in {horizonDays} trading days
        </span>
        {!compact && <span>{widthPct}% wide</span>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-sm font-semibold tabular-nums text-ink">
        <span>{formatMoney(low, currency)}</span>
        <span>{formatMoney(high, currency)}</span>
      </div>
      <div className="relative mt-1.5 h-2 rounded-full bg-series-2/20" role="img"
        aria-label={`Forecast range ${formatMoney(low, currency)} to ${formatMoney(high, currency)}${current != null ? `, latest close ${formatMoney(current, currency)}` : ""}`}>
        {current != null && (
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink"
            style={{ left: `${position}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {current != null && <p className="mt-1 text-[11px] text-muted">● latest close {formatMoney(current, currency)}</p>}
    </div>
  );
}
