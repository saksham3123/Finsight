import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/ui/Logo";
import Button from "../components/ui/Button";
import { Field, PasswordField } from "../components/ui/Form";
import { useAuth } from "../context/AuthContext";
import { readStorage, STORAGE_KEYS } from "../utils/storage";

/** Shared frame for the sign-in and sign-up pages. */
export function AuthFrame({ title, subtitle, children, footer }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo />
          <h1 className="mt-6 text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-ink-2">{subtitle}</p>
        </div>
        {children}
        <p className="mt-6 text-center text-sm text-ink-2">{footer}</p>
      </div>
    </main>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.title = "Sign in | FinSight";
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(form.get("email"), form.get("password"));
      navigate(readStorage(STORAGE_KEYS.lastRoute, "/"), { replace: true });
    } catch (err) {
      setError(err.status === 401 ? "Email or password is incorrect." : err.message);
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Welcome back to FinSight."
      footer={
        <>
          New to FinSight?{" "}
          <Link to="/register" className="font-semibold text-series-1 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="card space-y-4 p-6">
        <Field id="email" name="email" label="Email" type="email" autoComplete="email" required />
        <PasswordField id="password" name="password" label="Password" autoComplete="current-password" required />
        {error && (
          <p role="alert" className="text-sm text-bad-ink">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthFrame>
  );
}
