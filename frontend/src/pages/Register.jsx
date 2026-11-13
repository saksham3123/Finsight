import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import { Field, PasswordField } from "../components/ui/Form";
import { useAuth } from "../context/AuthContext";
import { AuthFrame } from "./Login";

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.title = "Create account | FinSight";
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get("password") !== form.get("confirm")) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(form.get("name").trim(), form.get("email"), form.get("password"));
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Create your account"
      subtitle="Track a portfolio, run SIPs and see model advisories."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-series-1 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="card space-y-4 p-6">
        <Field id="name" name="name" label="Name" autoComplete="name" maxLength={120} required />
        <Field id="email" name="email" label="Email" type="email" autoComplete="email" required />
        {/* The backend accepts 8–72 bytes (bcrypt's limit). */}
        <PasswordField id="password" name="password" label="Password" autoComplete="new-password" minLength={8} maxLength={72} required />
        <PasswordField id="confirm" name="confirm" label="Confirm password" autoComplete="new-password" minLength={8} maxLength={72} required />
        <p className="text-xs text-muted">At least 8 characters.</p>
        {error && (
          <p role="alert" className="text-sm text-bad-ink">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthFrame>
  );
}
