import { useMemo, useState } from "react";
import { PageTitle } from "../components/layout/Layout";
import TrendChart from "../components/charts/TrendChart";
import { Panel } from "../components/ui/Feedback";
import { formatINR, formatINRCompact } from "../utils/format";

/**
 * Future value of a SIP paid at the start of each month:
 *   FV = P × ((1 + i)^n − 1) / i × (1 + i),  i = annual rate / 12,  n = months
 */
export function sipValue(monthly, annualRatePct, months) {
  const i = annualRatePct / 100 / 12;
  if (i === 0) return monthly * months;
  return monthly * ((Math.pow(1 + i, months) - 1) / i) * (1 + i);
}

const FIELDS = [
  { key: "monthly", label: "Monthly investment", min: 500, max: 100000, step: 500, format: (v) => formatINR(v, { whole: true }) },
  { key: "rate", label: "Expected return (per year)", min: 1, max: 30, step: 0.5, format: (v) => `${v}%` },
  { key: "years", label: "Time period", min: 1, max: 40, step: 1, format: (v) => `${v} ${v === 1 ? "year" : "years"}` },
];

function SliderField({ field, value, onChange }) {
  const id = `sip-${field.key}`;
  const clamp = (v) => Math.min(field.max, Math.max(field.min, v));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {field.label}
        </label>
        <input
          type="number"
          aria-label={`${field.label} value`}
          min={field.min}
          max={field.max}
          step={field.step}
          value={value}
          onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))}
          onBlur={(e) => onChange(clamp(Number(e.target.value) || field.min))}
          className="w-28 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-right text-sm font-semibold text-ink outline-none focus:border-series-1"
        />
      </div>
      <input
        id={id}
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={clamp(value)}
        aria-valuetext={field.format(clamp(value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--series-1)]"
      />
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{field.format(field.min)}</span>
        <span>{field.format(field.max)}</span>
      </div>
    </div>
  );
}

export default function Sip() {
  const [inputs, setInputs] = useState({ monthly: 5000, rate: 12, years: 10 });
  const set = (key) => (v) => setInputs((s) => ({ ...s, [key]: v }));

  // Clamp for the maths so a half-typed number never produces a nonsense chart.
  const monthly = Math.min(100000, Math.max(500, inputs.monthly));
  const rate = Math.min(30, Math.max(1, inputs.rate));
  const years = Math.min(40, Math.max(1, Math.round(inputs.years)));

  const growth = useMemo(
    () =>
      Array.from({ length: years + 1 }, (_, y) => ({
        year: y,
        invested: monthly * 12 * y,
        value: Math.round(sipValue(monthly, rate, 12 * y)),
      })),
    [monthly, rate, years],
  );

  const final = growth[growth.length - 1];
  const gains = final.value - final.invested;

  return (
    <>
      <PageTitle title="SIP calculator" subtitle="See how a fixed monthly investment could grow. Returns are not guaranteed." />
      <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        <Panel title="Your plan">
          <div className="space-y-6 p-5">
            {FIELDS.map((f) => (
              <SliderField key={f.key} field={f} value={inputs[f.key]} onChange={set(f.key)} />
            ))}
          </div>
          <dl className="space-y-3 border-t border-line p-5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-2">Total invested</dt>
              <dd className="font-semibold text-ink">{formatINR(final.invested, { whole: true })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-2">Estimated returns</dt>
              <dd className="font-semibold text-ink">{formatINR(gains, { whole: true })}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt className="font-medium text-ink">Estimated value</dt>
              <dd className="text-xl font-bold text-ink">{formatINR(final.value, { whole: true })}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Growth over time">
          <div className="p-5">
            <TrendChart
              data={growth}
              xKey="year"
              xLabel="Year"
              series={[
                { key: "value", label: "Estimated value", color: "var(--series-1)" },
                { key: "invested", label: "Amount invested", color: "var(--series-2)" },
              ]}
              formatValue={(v) => formatINR(v, { whole: true })}
              formatAxis={formatINRCompact}
              formatLabel={(y) => `Yr ${y}`}
              height={340}
              caption={`At ${rate}% a year, ${formatINR(monthly, { whole: true })} a month for ${years} ${
                years === 1 ? "year" : "years"
              } could grow to ${formatINR(final.value, { whole: true })}.`}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}
