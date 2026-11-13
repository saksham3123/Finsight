import { Link } from "react-router-dom";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants = {
  primary: "bg-brand text-[#05261c] hover:brightness-95",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
};

export default function Button({ to, variant = "primary", className = "", children, ...props }) {
  const classes = `${base} ${variants[variant]} ${className}`;
  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}
