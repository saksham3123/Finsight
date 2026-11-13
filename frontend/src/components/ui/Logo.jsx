// FinSight wordmark: icon mark followed by the product name.
export default function Logo({ className = "" }) {
  return (
    <span className={`inline-flex items-center gap-2 text-xl font-bold tracking-tight text-ink ${className}`}>
      <img src="/favicon.png" alt="" className="h-6 w-auto" />
      FinSight
    </span>
  );
}
