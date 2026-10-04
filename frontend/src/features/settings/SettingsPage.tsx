/**
 * Settings and security (PRD §7.6, screen 7).
 *
 * Four things a user comes here for: their own contact details, their password
 * and second factor, the light/dark preference, and installing the app on a
 * phone. The security block is anchored at `#security` so the account menu and
 * a "enable two-factor" reminder can both deep-link straight to it.
 */

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader, Section } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { PageSpinner, useToast } from "@/components/ui/Feedback";
import { DescriptionItem, Field, Input } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { SegmentedControl } from "@/components/ui/Nav";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { PageHeader } from "@/components/ui/Page";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { ApiError, api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { copyToClipboard } from "@/lib/hooks";

type Theme = "light" | "dark";

const THEME_KEY = "complytrack.theme";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function SettingsPage() {
  const { user, refresh, can } = useAuth();
  const toast = useToast();

  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(display-mode: standalone)").matches,
  );

  /* ------------------------------- Profile ------------------------------- */
  const [name, setName] = useState(user?.name ?? "");
  const [mobile, setMobile] = useState(user?.mobile ?? "");
  const [employeeId, setEmployeeId] = useState(user?.employee_id ?? "");
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? "");
    setMobile(user.mobile ?? "");
    setEmployeeId(user.employee_id ?? "");
  }, [user]);

  const canEditProfile = can(PERM.MANAGE_ORG);

  /* ----------------------------- Password ----------------------------- */
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordBanner, setPasswordBanner] = useState<string | null>(null);

  /* -------------------------------- MFA -------------------------------- */
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; provisioning_uri: string } | null>(
    null,
  );
  const [mfaCode, setMfaCode] = useState("");
  const [mfaConfirmOpen, setMfaConfirmOpen] = useState(false);
  const [mfaBanner, setMfaBanner] = useState<string | null>(null);

  /* ---------------------------- PWA install ---------------------------- */
  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Chrome fires this when the app is installable; without it there is no
      // way to trigger the install prompt, so the card explains the manual path.
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const saveProfile = useMutation({
    mutationFn: () =>
      api(`/users/${user?.id}`, {
        method: "PATCH",
        json: { name, mobile: mobile || null, employee_id: employeeId || null },
      }),
    onSuccess: async () => {
      setProfileErrors({});
      toast.success("Profile updated", "Your contact details have been saved.");
      await refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setProfileErrors(error.byField);
        toast.error("Could not save your profile", error.detail);
      } else {
        toast.error("Could not save your profile");
      }
    },
  });

  const changePassword = useMutation({
    mutationFn: () =>
      api("/auth/password", {
        method: "POST",
        json: { current_password: currentPassword, new_password: newPassword },
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordErrors({});
      setPasswordBanner(null);
      toast.success(
        "Password changed",
        "Use the new password the next time you sign in. Other devices stay signed in until they expire.",
      );
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        toast.error("Could not change your password");
        return;
      }
      setPasswordErrors(error.byField);
      if (/current password/i.test(error.detail)) {
        setPasswordErrors((current) => ({
          ...current,
          current_password: error.detail,
        }));
        setPasswordBanner(null);
      } else {
        setPasswordBanner(error.detail);
      }
    },
  });

  const startMfa = useMutation({
    mutationFn: () => api<{ secret: string; provisioning_uri: string }>("/auth/mfa/setup", { method: "POST" }),
    onSuccess: (result) => {
      setMfaSetup(result);
      setMfaBanner(null);
    },
    onError: (error) =>
      setMfaBanner(error instanceof ApiError ? error.detail : "Could not start setup."),
  });

  const verifyMfa = useMutation({
    mutationFn: () => api("/auth/mfa/verify", { method: "POST", json: { code: mfaCode } }),
    onSuccess: async () => {
      setMfaSetup(null);
      setMfaCode("");
      setMfaBanner(null);
      toast.success("Two-factor authentication is on", "You will be asked for a code at sign-in.");
      await refresh();
    },
    onError: (error) =>
      setMfaBanner(error instanceof ApiError ? error.detail : "That code did not match."),
  });

  const disableMfa = useMutation({
    mutationFn: () => api("/auth/mfa/disable", { method: "POST" }),
    onSuccess: async () => {
      setMfaConfirmOpen(false);
      setMfaSetup(null);
      toast.success(
        "Two-factor authentication is off",
        "Your account is now protected by a password alone.",
      );
      await refresh();
    },
    onError: (error) => {
      setMfaConfirmOpen(false);
      toast.error(
        "Could not turn off two-factor authentication",
        error instanceof ApiError ? error.detail : "Please try again.",
      );
    },
  });

  if (!user) return <PageSpinner label="Loading your settings" />;

  const copy = async (value: string, label: string) => {
    const ok = await copyToClipboard(value);
    if (ok) toast.success(`${label} copied`, "Paste it into your authenticator app.");
    else toast.error("Could not copy", "Select the text and copy it manually.");
  };

  const changeTheme = (next: Theme) => {
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* The preference simply does not persist; the session still works. */
    }
  };

  const install = async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
        toast.success("Installing ComplyTrack", "Look for the icon on your home screen.");
      }
      setInstallEvent(null);
    } catch {
      setInstallEvent(null);
      toast.info("Install from your browser menu", "Use the browser's own Install option.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Your contact details, sign-in security and how the app looks on this device."
      />

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-4 sm:px-6 sm:py-5">
        {/* ------------------------------ Profile ------------------------------ */}
        <Card>
          <CardHeader
            title="Your profile"
            description="These details identify you as the owner of an obligation and appear in reminder e-mails."
          />
          <div className="p-4 sm:p-5">
            {canEditProfile ? (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveProfile.mutate();
                }}
              >
                <Field label="Full name" error={profileErrors.name} required>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                      required
                    />
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Mobile number" error={profileErrors.mobile} hint="For SMS reminders">
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={mobile ?? ""}
                        onChange={(event) => setMobile(event.target.value)}
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="+91 98xxx xxxxx"
                      />
                    )}
                  </Field>
                  <Field label="Employee ID" error={profileErrors.employee_id}>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={employeeId ?? ""}
                        onChange={(event) => setEmployeeId(event.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <Button type="submit" variant="primary" icon="save" loading={saveProfile.isPending}>
                  Save changes
                </Button>
              </form>
            ) : (
              <>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <DescriptionItem label="Full name">{user.name}</DescriptionItem>
                  <DescriptionItem label="Work e-mail">{user.email}</DescriptionItem>
                  <DescriptionItem label="Mobile number">{user.mobile ?? "—"}</DescriptionItem>
                  <DescriptionItem label="Employee ID">{user.employee_id ?? "—"}</DescriptionItem>
                  <DescriptionItem label="Role">{user.role}</DescriptionItem>
                  <DescriptionItem label="Last signed in">
                    {user.last_login_at ? formatDateTime(user.last_login_at) : "—"}
                  </DescriptionItem>
                </dl>
                <p className="mt-4 flex items-start gap-2 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5 text-xs text-ink-muted">
                  <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                  Your contact details are maintained by an administrator. Ask your compliance
                  administrator to correct anything here.
                </p>
              </>
            )}
          </div>
        </Card>

        {/* ------------------------------ Security ------------------------------ */}
        <div id="security" className="scroll-mt-20">
          <Section title="Security" description="Your password and second factor.">
            {/* Change password */}
            <Card>
              <CardHeader
                title="Change password"
                description="At least eight characters. The new password takes effect at your next sign-in."
              />
              <form
                className="space-y-4 p-4 sm:p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setPasswordBanner(null);
                  const errors: Record<string, string> = {};
                  if (newPassword.length < 8) {
                    errors.new_password = "Use at least eight characters.";
                  }
                  if (confirmPassword !== newPassword) {
                    errors.confirm_password = "The two passwords do not match.";
                  }
                  if (!currentPassword) errors.current_password = "Enter your current password.";
                  setPasswordErrors(errors);
                  if (Object.keys(errors).length) return;
                  changePassword.mutate();
                }}
              >
                {passwordBanner && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2.5 text-xs text-rag-red"
                  >
                    <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
                    {passwordBanner}
                  </p>
                )}

                <Field label="Current password" error={passwordErrors.current_password} required>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      required
                    />
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="New password"
                    error={passwordErrors.new_password}
                    hint="8+ characters"
                    required
                  >
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        required
                      />
                    )}
                  </Field>
                  <Field label="Confirm new password" error={passwordErrors.confirm_password} required>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        required
                      />
                    )}
                  </Field>
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  icon="lock"
                  loading={changePassword.isPending}
                  disabled={!currentPassword || !newPassword || !confirmPassword}
                >
                  Change password
                </Button>
              </form>
            </Card>

            {/* Two-factor authentication */}
            <Card className="mt-3">
              <CardHeader
                title="Two-factor authentication"
                description="A six-digit code from an authenticator app, asked for after your password."
                actions={
                  user.mfa_enabled ? (
                    <Chip icon="verified" className="bg-rag-green-bg text-rag-green border-rag-green-border">
                      Enabled
                    </Chip>
                  ) : (
                    <Chip icon="alert">Not enabled</Chip>
                  )
                }
              />

              <div className="space-y-4 p-4 sm:p-5">
                {mfaBanner && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2.5 text-xs text-rag-red"
                  >
                    <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
                    {mfaBanner}
                  </p>
                )}

                {user.mfa_enabled ? (
                  <>
                    <p className="text-sm text-ink-muted">
                      Two-factor authentication is protecting your account. You can turn it off if
                      you are changing devices — you will be asked to enrol again to switch it back
                      on.
                    </p>
                    <Button
                      variant="danger"
                      icon="shield-alert"
                      onClick={() => setMfaConfirmOpen(true)}
                      loading={disableMfa.isPending}
                    >
                      Turn off two-factor authentication
                    </Button>
                  </>
                ) : !mfaSetup ? (
                  <>
                    <p className="text-sm text-ink-muted">
                      Add a second step to your sign-in. You will need an authenticator app such as
                      Google Authenticator, Microsoft Authenticator or 1Password.
                    </p>
                    <Button
                      variant="primary"
                      icon="shield-check"
                      onClick={() => startMfa.mutate()}
                      loading={startMfa.isPending}
                    >
                      Set up two-factor authentication
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="rounded-[var(--radius-control)] border border-line bg-surface-muted p-3.5">
                      <p className="text-xs font-semibold text-ink">
                        Add this secret to your authenticator app
                      </p>
                      <p className="mt-1 text-2xs text-ink-subtle">
                        This deployment cannot render a QR code without an additional library, so
                        the secret and the setup link are given as copyable text. Both contain the
                        same information a QR code would; nothing leaves your device.
                      </p>

                      <div className="mt-3 space-y-3">
                        <div>
                          <p className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">
                            Secret key
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2 font-mono text-xs text-ink">
                              {mfaSetup.secret}
                            </code>
                            <Button
                              size="sm"
                              icon="copy"
                              onClick={() => void copy(mfaSetup.secret, "Secret key")}
                            >
                              Copy
                            </Button>
                          </div>
                        </div>

                        <div>
                          <p className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">
                            Setup link (otpauth)
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2 font-mono text-xs text-ink">
                              {mfaSetup.provisioning_uri}
                            </code>
                            <Button
                              size="sm"
                              icon="copy"
                              onClick={() =>
                                void copy(mfaSetup.provisioning_uri, "Setup link")
                              }
                            >
                              Copy
                            </Button>
                          </div>
                          <p className="mt-1 text-2xs text-ink-subtle">
                            Or open the link on this device to hand it straight to your
                            authenticator app.
                          </p>
                        </div>
                      </div>
                    </div>

                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (mfaCode.length === 6) verifyMfa.mutate();
                      }}
                    >
                      <Field
                        label="Enter the six-digit code to confirm"
                        required
                        hint="Codes refresh every 30 seconds"
                      >
                        {({ id, describedBy, invalid }) => (
                          <Input
                            id={id}
                            aria-describedby={describedBy}
                            invalid={invalid}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder="000000"
                            className="tabular max-w-40 tracking-[0.4em]"
                            value={mfaCode}
                            onChange={(event) =>
                              setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                            }
                          />
                        )}
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          variant="primary"
                          icon="check"
                          loading={verifyMfa.isPending}
                          disabled={mfaCode.length !== 6}
                        >
                          Verify and enable
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setMfaSetup(null);
                            setMfaCode("");
                            setMfaBanner(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </>
                )}
              </div>
            </Card>
          </Section>
        </div>

        {/* ------------------------------- Theme ------------------------------- */}
        <Card>
          <CardHeader
            title="Appearance"
            description="The dark theme keeps the glare down for night-shift checks in the yard."
          />
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <p className="text-sm text-ink-muted">
              Your choice is saved in this browser and applies to every screen.
            </p>
            <SegmentedControl
              label="Theme"
              value={theme}
              onChange={changeTheme}
              options={[
                { value: "light", label: "Light", icon: "sun" },
                { value: "dark", label: "Dark", icon: "moon" },
              ]}
            />
          </div>
        </Card>

        {/* ----------------------------- Install app ----------------------------- */}
        <Card>
          <CardHeader
            title="Install the app"
            description="Add ComplyTrack to your home screen for one-tap access and push reminders."
          />
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <p className="text-sm text-ink-muted">
              {installed
                ? "ComplyTrack is installed on this device."
                : installEvent
                  ? "Your browser is ready to install ComplyTrack as an app."
                  : "Your browser has not offered an automatic install. Use its own Install or “Add to Home Screen” option from the browser menu."}
            </p>
            <Button
              icon="download"
              variant={installed ? "secondary" : "primary"}
              disabled={installed || !installEvent}
              onClick={() => void install()}
              className="sm:shrink-0"
            >
              {installed ? "Installed" : "Install app"}
            </Button>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={mfaConfirmOpen}
        onClose={() => setMfaConfirmOpen(false)}
        onConfirm={() => disableMfa.mutate()}
        title="Turn off two-factor authentication?"
        message="Your account will be protected by your password alone. You can turn it back on at any time by enrolling an authenticator app again."
        confirmLabel="Turn off"
        loading={disableMfa.isPending}
      />
    </div>
  );
}
