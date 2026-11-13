import { useState } from "react";
import { FaHandPointer, FaXmark } from "react-icons/fa6";
import { readStorage, STORAGE_KEYS, writeStorage } from "../../utils/storage";

/**
 * Small dismissible tip laid over a chart. Only the card itself takes pointer events,
 * so the chart underneath stays hoverable. Once dismissed it stays hidden on later visits.
 */
export default function ChartHint({ children }) {
  const [hidden, setHidden] = useState(() => readStorage(STORAGE_KEYS.chartHintDismissed) === "1");
  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    writeStorage(STORAGE_KEYS.chartHintDismissed, "1");
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-4">
      <div
        role="note"
        className="pointer-events-auto flex max-w-md animate-slide-up items-start gap-3 rounded-lg border border-line bg-surface/95 px-4 py-3 text-sm shadow-lg backdrop-blur"
      >
        <FaHandPointer className="mt-0.5 shrink-0 text-series-1" aria-hidden="true" />
        <div className="text-ink-2">{children}</div>
        <button type="button" onClick={dismiss} aria-label="Dismiss tip" className="shrink-0 text-muted hover:text-ink">
          <FaXmark />
        </button>
      </div>
    </div>
  );
}
