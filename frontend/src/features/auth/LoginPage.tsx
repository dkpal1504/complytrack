/**
 * Sign-in.
 *
 * Two steps in one screen: the password, then — only when the account has a
 * second factor — the six-digit authenticator code. The layout is a branded
 * split on a desktop (where there is room to say what the product is and where
 * the data lives) and a single compact column on a phone, because most of this
 * app is used standing up.
 */

import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Checkbox } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/features/auth/auth-context";
import { ApiError, setRefreshToken } from "@/lib/api";

/** The seeded accounts, shown only in a development build. */
const DEMO_ACCOUNTS: { role: string; email: string }[] = [
  { role: "Administrator", email: "admin@complytrack.local" },
  { role: "Compliance Team", email: "compliance@complytrack.local" },
  { role: "Department User", email: "safety.owner@complytrack.local" },
  { role: "Management View", email: "unit.head@complytrack.local" },
  { role: "Auditor", email: "auditor@complytrack.local" },
];

const DEMO_PASSWORD = "Comply@2026!";

/** Only ever redirect to a path inside this app — never an absolute URL. */
function safeRedirect(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-brand-700 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, var(--color-brand-400) 0, transparent 45%), radial-gradient(circle at 80% 75%, var(--color-brand-500) 0, transparent 50%)",
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-white/15">
            <Icon name="shield-check" size={24} />
          </span>
          <span className="text-xl font-semibold tracking-tight">ComplyTrack</span>
        </div>
        <h1 className="mt-10 max-w-md text-3xl leading-tight font-semibold">
          Statutory compliance, licences and certificates — tracked to the day.
        </h1>
        <p className="mt-3 max-w-md text-sm text-white/80">
          One register for every obligation across the yard, with renewals, reminders,
          escalations and a tamper-evident audit trail.
        </p>
      </div>

      <div className="relative max-w-md rounded-[var(--radius-card)] border border-white/15 bg-white/10 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Icon name="map" size={16} />
          Hosted in India
        </p>
        <p className="mt-1 text-xs leading-relaxed text-white/80">
          Personal data is limited to work contact details and stays in an India-hosted,
          access-controlled deployment, aligned with the DPDP Act 2023. Defence-related
          documents never leave this environment.
        </p>
      </div>
    </aside>
  );
}

export default function LoginPage() {
  const { user, signIn, completeMfa, error: authError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = safeRedirect((location.state as { from?: unknown } | null)?.from);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user && step !== "mfa") return <Navigate to={from} replace />;

  const fail = (caught: unknown) => {
    if (caught instanceof ApiError) {
      setFieldErrors(caught.byField);
      setBanner(caught.detail);
    } else {
      setBanner("Something went wrong. Please try again.");
    }
  };

  const finish = (signedIn: { mfaRequired: boolean }) => {
    if (signedIn.mfaRequired) {
      setStep("mfa");
      return;
    }
    // "Remember me" is the choice to keep the session across a browser restart.
    if (!remember) setRefreshToken(null);
    navigate(from, { replace: true });
  };

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setBanner(null);
    setFieldErrors({});
    try {
      const result = await signIn(email.trim(), password);
      finish(result);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setBanner(null);
    try {
      await completeMfa(code);
      if (!remember) setRefreshToken(null);
      navigate(from, { replace: true });
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setStep("credentials");
    setFieldErrors({});
    setBanner(null);
  };

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-2">
      <BrandPanel />

      <main className="flex flex-col justify-center px-4 py-8 sm:px-8">
        <div className="mx-auto w-full max-w-sm">
          {/* Compact brand for the phone, where the left panel is hidden. */}
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-600 text-white">
              <Icon name="shield-check" size={21} />
            </span>
            <span>
              <span className="block text-lg leading-tight font-semibold text-ink">
                ComplyTrack
              </span>
              <span className="block text-2xs text-ink-muted">
                Statutory compliance management
              </span>
            </span>
          </div>

          <Card className="p-5 sm:p-6">
            {step === "credentials" ? (
              <form onSubmit={submitCredentials} noValidate>
                <h1 className="text-xl font-semibold text-ink">Sign in</h1>
                <p className="mt-1 mb-5 text-sm text-ink-muted">
                  Use your work e-mail address and password.
                </p>

                {banner && (
                  <div
                    role="alert"
                    className="mb-4 flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2.5 text-xs text-rag-red"
                  >
                    <Icon name="alert-circle" size={15} className="mt-0.5 shrink-0" />
                    <span>{banner}</span>
                  </div>
                )}

                <div className="space-y-4">
                  <Field label="E-mail address" error={fieldErrors.email} required>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        type="email"
                        name="email"
                        icon="mail"
                        autoComplete="username"
                        // Sign-in is the page's only task, and it is reached
                        // deliberately — there is no content to skip past, so
                        // focus starts where the typing does.
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                      />
                    )}
                  </Field>

                  <Field label="Password" error={fieldErrors.password} required>
                    {({ id, describedBy, invalid }) => (
                      <div className="relative">
                        <Input
                          id={id}
                          aria-describedby={describedBy}
                          invalid={invalid}
                          type={showPassword ? "text" : "password"}
                          name="password"
                          autoComplete="current-password"
                          placeholder="Your password"
                          className="pr-16"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          aria-pressed={showPassword}
                          className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline-2"
                        >
                          {showPassword ? "Hide" : "Show"}
                        </button>
                      </div>
                    )}
                  </Field>
                </div>

                <div className="mt-4">
                  <Checkbox
                    label="Keep me signed in on this device"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  block
                  loading={busy}
                  disabled={!email || !password}
                  className="mt-6"
                >
                  Sign in
                </Button>

                {authError && !banner && (
                  <p role="alert" className="mt-3 text-xs text-rag-red">
                    {authError}
                  </p>
                )}
              </form>
            ) : (
              <form onSubmit={submitCode} noValidate>
                <h1 className="text-xl font-semibold text-ink">Enter your code</h1>
                <p className="mt-1 mb-5 text-sm text-ink-muted">
                  Open your authenticator app and enter the current six-digit code for
                  ComplyTrack.
                </p>

                {banner && (
                  <div
                    role="alert"
                    className="mb-4 flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2.5 text-xs text-rag-red"
                  >
                    <Icon name="alert-circle" size={15} className="mt-0.5 shrink-0" />
                    <span>{banner}</span>
                  </div>
                )}

                <Field label="Six-digit code" error={fieldErrors.code} required>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="text"
                      name="one-time-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      // The one-time-code step replaces the password form
                      // mid-flow. Moving focus onto it is what tells a screen
                      // reader the step changed, rather than leaving focus on a
                      // field that is no longer on screen.
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      maxLength={6}
                      placeholder="000000"
                      className="tabular tracking-[0.4em]"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                    />
                  )}
                </Field>

                <Button
                  type="submit"
                  variant="primary"
                  block
                  loading={busy}
                  disabled={code.length !== 6}
                  className="mt-6"
                >
                  Verify and sign in
                </Button>
                <Button
                  variant="ghost"
                  block
                  className="mt-2"
                  onClick={() => {
                    setStep("credentials");
                    setCode("");
                    setBanner(null);
                  }}
                >
                  Back to sign-in
                </Button>
              </form>
            )}
          </Card>

          {import.meta.env.DEV && step === "credentials" && (
            <div className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface-muted/60 p-3.5">
              <p className="flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
                <Icon name="sparkles" size={13} />
                Demo accounts (development only)
              </p>
              <p className="mt-1 text-2xs text-ink-subtle">
                Every account uses the password <span className="font-mono">{DEMO_PASSWORD}</span>.
                Tap one to fill the form.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => fillDemo(account.email)}
                    aria-label={`Fill the form with the ${account.role} demo account`}
                    className="rounded-full border border-line bg-surface px-2.5 py-1 text-2xs font-medium text-ink-muted transition-colors hover:border-brand-300 hover:text-brand-700 focus-visible:outline-2"
                  >
                    {account.role}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
