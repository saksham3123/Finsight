import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FaChartLine, FaTable } from "react-icons/fa6";

const tick = { fill: "var(--muted)", fontSize: 12 };

function ChartTooltip({ active, payload, label, series, formatValue, formatLabel, forecast }) {
  if (!active || !payload?.length) return null;
  const band = payload.find((p) => p.dataKey === "band")?.value;
  const future = payload[0]?.payload?.future;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 text-xs text-muted">{formatLabel(label)}{future ? " · forecast" : ""}</p>
      {future && band && (
        <p className="text-ink">
          <span className="text-ink-2">{forecast.label}: </span>
          <span className="font-semibold tabular-nums">{formatValue(band[0])} – {formatValue(band[1])}</span>
        </p>
      )}
      {series.map((s) => {
        const item = payload.find((p) => p.dataKey === s.key);
        if (!item) return null;
        return (
          <p key={s.key} className="flex items-center gap-2 text-ink">
            {series.length > 1 && <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />}
            {series.length > 1 && <span className="text-ink-2">{s.label}</span>}
            <span className="ml-auto font-semibold tabular-nums">{formatValue(item.value)}</span>
          </p>
        );
      })}
    </div>
  );
}

// Direct label at the end of each line when there are several series, so identity isn't colour-only.
function EndLabel({ x, y, index, last, text }) {
  if (index !== last) return null;
  return (
    <text x={x - 6} y={y - 10} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--ink-2)">
      {text}
    </text>
  );
}

/**
 * Future points for a forecast cone after the last data point. The band starts at the last value
 * and widens with the square root of time (how return volatility scales) to [low, high] on the
 * final day, so intermediate days show a consistent, narrower range.
 */
function forecastPoints(data, xKey, valueKey, forecast) {
  const last = data[data.length - 1];
  const start = last?.[valueKey];
  if (!forecast || !start) return data;
  const n = forecast.dates.length;
  const future = forecast.dates.map((date, i) => {
    const t = Math.sqrt((i + 1) / n);
    return { [xKey]: date, future: true, band: [start * (forecast.low / start) ** t, start * (forecast.high / start) ** t] };
  });
  return [...data.slice(0, -1), { ...last, band: [start, start] }, ...future];
}

/**
 * Time-series area chart with a hover crosshair and a table view of the same data.
 * series: [{ key, label, color }]. One series needs no legend; two or more get one.
 * forecast (optional, single series only): { low, high, dates: [future x values], label } draws
 * a shaded range cone after the last point. The table view lists real data only.
 */
export default function TrendChart({
  data,
  series,
  xKey = "date",
  xLabel = "Date",
  height = 280,
  formatValue = String,
  formatAxis = formatValue,
  formatLabel = String,
  overlay = null,
  caption,
  forecast = null,
}) {
  const [view, setView] = useState("chart");
  const chartData = forecast && series.length === 1 ? forecastPoints(data, xKey, series[0].key, forecast) : data;
  const gradientId = useId().replace(/:/g, "");
  const many = series.length > 1;
  // Recharts' "auto" domain ignores range-valued (band) areas, so include the cone explicitly.
  let domain = many ? [0, "auto"] : ["auto", "auto"];
  if (chartData !== data) {
    const values = chartData.flatMap((row) => [row[series[0].key], ...(row.band ?? [])]).filter((v) => v != null);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.04;
    domain = [lo - pad, hi + pad];
  }

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {many ? (
          <ul className="flex flex-wrap gap-4 text-sm text-ink-2" aria-label="Legend">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
        >
          {view === "chart" ? <FaTable aria-hidden="true" /> : <FaChartLine aria-hidden="true" />}
          {view === "chart" ? "Table" : "Chart"}
        </button>
      </div>

      {view === "chart" ? (
        <div className="relative" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s.key} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={many ? 0.12 : 0.22} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey={xKey}
                tickFormatter={formatLabel}
                tick={tick}
                tickLine={false}
                axisLine={{ stroke: "var(--grid)" }}
                minTickGap={32}
              />
              <YAxis
                tickFormatter={formatAxis}
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={72}
                domain={domain}
              />
              <Tooltip
                cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
                content={<ChartTooltip series={series} formatValue={formatValue} formatLabel={formatLabel} forecast={forecast} />}
              />
              {chartData !== data && (
                <Area
                  type="monotone"
                  dataKey="band"
                  name={forecast.label}
                  stroke="var(--series-2)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  fill="var(--series-2)"
                  fillOpacity={0.16}
                  activeDot={false}
                  isAnimationActive={false}
                />
              )}
              {series.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#${gradientId}-${i})`}
                  activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={false}
                  label={many ? (p) => <EndLabel {...p} last={data.length - 1} text={s.label} /> : false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          {overlay}
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: height }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{xLabel}</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((row) => (
                <tr key={row[xKey]} className="border-t border-line">
                  <td className="px-3 py-1.5 text-ink-2">{formatLabel(row[xKey])}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right text-ink">
                      {formatValue(row[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {caption && <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>}
    </figure>
  );
}
