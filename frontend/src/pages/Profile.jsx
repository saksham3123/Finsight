import { PageTitle } from "../components/layout/Layout";
import { ErrorState, Panel, Skeleton } from "../components/ui/Feedback";
import useAsync from "../hooks/useAsync";
import { getMe } from "../services/userService";
import { formatDate } from "../utils/format";

export default function Profile() {
  const { data: user, error, reload } = useAsync(() => getMe().then((r) => r.user), []);

  return (
    <>
      <PageTitle title="Profile" subtitle="Your account details." />
      <Panel className="max-w-2xl">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !user ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : (
          <dl className="divide-y divide-line">
            {[
              ["Name", user.name],
              ["Email", user.email],
              ["Member since", formatDate(user.createdAt, true)],
              ["Role", user.role === "admin" ? "Administrator" : "Investor"],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-3 gap-4 px-5 py-4 text-sm">
                <dt className="text-muted">{label}</dt>
                <dd className="col-span-2 font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>
    </>
  );
}
