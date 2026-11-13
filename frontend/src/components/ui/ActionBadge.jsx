import { FaArrowTrendDown, FaArrowTrendUp, FaEye, FaPause, FaTriangleExclamation } from "react-icons/fa6";

// The five advisory signals from the backend. Status colours always come with an icon and a label.
const STYLES = {
  buy: { label: "Buy", Icon: FaArrowTrendUp, className: "bg-good-soft text-good-ink ring-good/30" },
  hold: { label: "Hold", Icon: FaPause, className: "bg-surface-2 text-ink-2 ring-line" },
  sell: { label: "Sell", Icon: FaArrowTrendDown, className: "bg-bad-soft text-bad-ink ring-bad/30" },
  watch: { label: "Watch", Icon: FaEye, className: "bg-warn-soft text-warn-ink ring-warn/40" },
  high_risk: { label: "High risk", Icon: FaTriangleExclamation, className: "bg-bad-soft text-bad-ink ring-bad/30" },
};

export default function ActionBadge({ signal }) {
  const { label, Icon, className } = STYLES[signal] ?? STYLES.hold;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${className}`}>
      <Icon aria-hidden="true" />
      {label}
    </span>
  );
}
