import { useState } from "react";
import { FaEye, FaEyeSlash } from "react-icons/fa6";

export const inputClass =
  "block w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-muted focus:border-series-1";

export function Label({ htmlFor, children }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
      {children}
    </label>
  );
}

export function Field({ id, label, hint, className = "", ...props }) {
  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <input id={id} className={inputClass} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

// Password input with a show/hide toggle.
export function PasswordField({ id, label, className = "", ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="relative">
        <input id={id} type={visible ? "text" : "password"} className={`${inputClass} pr-11`} {...props} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-ink"
        >
          {visible ? <FaEyeSlash /> : <FaEye />}
        </button>
      </div>
    </div>
  );
}
