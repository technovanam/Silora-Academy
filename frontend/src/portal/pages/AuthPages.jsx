import React, { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { SITE } from "../../data/site";
import { useAuth } from "../lib/auth.jsx";
import { auth } from "../lib/firebase.js";
import { PORTAL_API } from "../lib/api.js";
import { Button, Field, Input, Notice, Loading } from "../ui/index.jsx";

export const homeFor = (user) => (user ? `/portal/${user.role}` : "/portal/login");

const POINTS = ["Join live classes in one click", "Your materials and schedule in one place", "Track attendance and progress"];
// Photo: students studying together – Unsplash (free to use under the Unsplash License)
const AUTH_BG = "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1400&q=80";

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-svh bg-white lg:grid-cols-2">
      {/* Left: brand panel with photo (hidden on small screens) */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy bg-cover bg-center p-12 text-white lg:flex xl:p-16" style={{ backgroundImage: `url(${AUTH_BG})` }}>
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/80 to-navy/40" aria-hidden="true" />
        <Link to="/" className="relative w-fit rounded-xl bg-white px-3 py-2">
          <img src={SITE.logo} alt={SITE.name} className="h-10 w-auto mix-blend-multiply" />
        </Link>
        <div className="relative max-w-md">
          <p className="text-left text-4xl font-bold leading-tight text-white">
            Learn better with <span className="text-brand">Silora Academy</span>
          </p>
          <p className="mt-4 text-base leading-relaxed text-white/70">One portal for students, parents, teachers and admins.</p>
          <ul className="mt-8 space-y-3">
            {POINTS.map((t) => (
              <li key={t} className="flex items-center gap-3 text-[15px] text-white/85">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-brand" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/50">©{new Date().getFullYear()} Silora Academy</p>
      </aside>

      {/* Right: form */}
      <main className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Link to="/" className="lg:invisible">
            <img src={SITE.logo} alt={SITE.name} className="h-10 w-auto mix-blend-multiply" />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy">
            <ArrowLeft className="h-4 w-4" /> Back to website
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-bold tracking-tight text-navy">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <Input icon={Lock} type={show ? "text" : "password"} className="pr-11" {...props} />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:text-navy" aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </span>
  );
}
export { PasswordInput };

export function LoginPage() {
  const { user, loading, login, endedReason, clearEnded } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (loading) return <Loading className="min-h-svh" />;
  if (user) return <Navigate to={location.state?.from || homeFor(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    clearEnded();
    setBusy(true);
    try {
      const me = await login(email.trim(), password);
      navigate(location.state?.from || homeFor(me.user), { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your Silora Academy portal.">
      <form onSubmit={submit} className="space-y-5">
        {endedReason && !error && <Notice tone="warn">{endedReason}</Notice>}
        {error && (
          <Notice tone="danger">
            {error.message}
            {error.code === "locked" && (
              <>
                {" "}
                <Link to="/portal/forgot-password" className="font-semibold underline">
                  Reset password
                </Link>
              </>
            )}
          </Notice>
        )}
        <Field label="User ID (email)">
          <Input icon={Mail} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <Link to="/portal/forgot-password" className="text-sm font-semibold text-navy hover:text-brand-hover">
              Forgot?
            </Link>
          </div>
          <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" required aria-label="Password" />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
        <p className="text-center text-sm text-muted">
          Don't have an account? <Link to="/contact" className="font-semibold text-navy hover:underline">Contact us</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${PORTAL_API}/auth/forgot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      if (!res.ok) throw new Error("Something went wrong. Please try again.");
      setSent(true);
    } catch (err) {
      setError(err.message === "Failed to fetch" ? "Can't reach the server. Check your connection." : err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Reset your password" subtitle="Enter the email you sign in with. We'll send you a link to choose a new password.">
      {sent ? (
        <div className="space-y-5">
          <Notice tone="success">If an active account uses <strong>{email}</strong>, a reset link is on its way. The link expires in 1 hour.</Notice>
          <Link to="/portal/login" className="inline-flex items-center gap-2 text-sm font-semibold text-navy">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Email">
            <Input icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Send reset link
          </Button>
          <Link to="/portal/login" className="inline-flex items-center gap-2 text-sm font-semibold text-navy">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </form>
      )}
    </AuthShell>
  );
}

const strong = (p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const code = params.get("oobCode");
  const welcome = params.get("welcome");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!strong(pw)) return setError("Use at least 8 characters with a letter and a number.");
    if (pw !== pw2) return setError("The passwords don't match.");
    setBusy(true);
    try {
      await verifyPasswordResetCode(auth, code);
      await confirmPasswordReset(auth, code, pw);
      setDone(true);
    } catch {
      setError("This link is invalid or has expired. Request a new one.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={welcome ? "Set your password" : "Choose a new password"} subtitle={welcome ? "Welcome to Silora Academy! Create a password to activate your portal account." : "Pick something you haven't used before."}>
      {!code ? (
        <Notice tone="danger">
          This link is incomplete. <Link to="/portal/forgot-password" className="font-semibold underline">Request a new one</Link>.
        </Notice>
      ) : done ? (
        <div className="space-y-5">
          <Notice tone="success">Your password has been updated. You can sign in now.</Notice>
          <Link to="/portal/login">
            <Button size="lg" className="w-full">Go to sign in</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="New password" hint="At least 8 characters, with a letter and a number">
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Field label="Confirm password">
            <PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Save password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
