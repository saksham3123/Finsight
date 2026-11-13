import { PageTitle } from "../components/layout/Layout";
import Button from "../components/ui/Button";

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <PageTitle title="Page not found" />
      <p className="-mt-2 text-sm text-ink-2">The page you were looking for doesn&apos;t exist or has moved.</p>
      <Button to="/" className="mt-6">
        Back to dashboard
      </Button>
    </div>
  );
}
