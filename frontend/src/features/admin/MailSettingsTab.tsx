/**
 * The mail server settings, and the button that proves them.
 *
 * Reminder e-mails are only as real as the relay behind them. Left unset, the
 * engine still runs and still writes every message — it spools them to disk
 * instead of sending — so this screen exists to close that last gap: point the
 * engine at a relay, then send one message and see exactly what the relay said.
 *
 * A value set in the environment (``SMTP_HOST`` and friends) wins outright and
 * makes this screen read-only, because a deployment that has pinned a relay must
 * not be quietly overridden from a web form.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card, Section } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ErrorState, SkeletonRows, useToast } from "@/components/ui/Feedback";
import { Field, Input, Switch } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Page";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateAdmin } from "@/lib/query";
import type { MailConfigResponse, TestEmailResult } from "@/features/admin/admin-types";

interface Draft {
  host: string;
  port: string;
  user: string;
  sender: string;
  use_tls: boolean;
  use_ssl: boolean;
}

const draftFrom = (config: MailConfigResponse): Draft => ({
  host: config.host,
  port: String(config.port),
  user: config.user,
  sender: config.sender,
  use_tls: config.use_tls,
  use_ssl: config.use_ssl,
});

export function MailSettingsTab() {
  const query = useQuery({
    queryKey: qk.reminders.mail,
    queryFn: () => api<MailConfigResponse>("/reminders/mail"),
  });

  if (query.error) {
    return (
      <Card className="overflow-hidden">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Card>
    );
  }

  // The form is mounted only once the stored values are known, so it can take
  // them as its starting state rather than filling itself in afterwards.
  if (!query.data) {
    return (
      <Card className="overflow-hidden">
        <div className="p-4 sm:p-5">
          <SkeletonRows rows={5} />
        </div>
      </Card>
    );
  }

  return <MailSettingsForm config={query.data} />;
}

function MailSettingsForm({ config }: { config: MailConfigResponse }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [draft, setDraft] = useState<Draft>(() => draftFrom(config));
  // Held apart from the rest so an untouched password can be left out of the
  // request entirely and the stored one survives.
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [recipient, setRecipient] = useState("");

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        host: draft.host.trim(),
        port: Number(draft.port) || 587,
        user: draft.user.trim(),
        sender: draft.sender.trim(),
        use_tls: draft.use_tls,
        use_ssl: draft.use_ssl,
      };
      if (passwordTouched) payload.password = password;
      return api<MailConfigResponse>("/reminders/mail", { method: "PUT", json: payload });
    },
    onSuccess: (saved) => {
      setPassword("");
      setPasswordTouched(false);
      toast.success(
        saved.smtp_configured ? "Mail settings saved" : "Mail settings saved — still no relay",
        saved.smtp_configured
          ? "Reminders will be sent through this relay from the next run."
          : "Reminders will keep spooling to the outbox until a host is set.",
      );
      // Covers the mail config itself, the outbox it explains, and the audit
      // trail that recorded the change.
      invalidateAdmin(queryClient);
    },
    onError: (error) => {
      toast.error(
        "Could not save the mail settings",
        error instanceof ApiError ? error.detail : undefined,
      );
    },
  });

  const test = useMutation({
    mutationFn: () =>
      api<TestEmailResult>("/reminders/test-email", {
        method: "POST",
        json: recipient.trim() ? { to: recipient.trim() } : {},
      }),
    onSuccess: (result) => {
      // A refused password is an ordinary answer to show, so the outcome travels
      // in the result rather than as a thrown error.
      if (result.ok) {
        toast.success(
          result.mode === "smtp" ? `Test e-mail sent to ${result.to}` : "Test e-mail spooled to the outbox",
          result.detail,
        );
      } else {
        toast.error("The test e-mail was not sent", result.detail);
      }
      // A spooled test lands in the outbox, so the Outbox tab must not go stale.
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
    },
    onError: (error) => {
      toast.error(
        "Could not send the test e-mail",
        error instanceof ApiError ? error.detail : undefined,
      );
    },
  });

  const readOnly = config.read_only;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Outgoing mail (SMTP)</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              The relay ComplyTrack sends reminder and escalation e-mails through.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {config.source === "environment" && (
              <Chip icon="lock" className="border-line bg-surface-muted text-ink-muted">
                Set by the environment
              </Chip>
            )}
            {config.smtp_configured ? (
              <Chip icon="check-circle" className="border-rag-green-border bg-rag-green-bg text-rag-green">
                Mail is being sent
              </Chip>
            ) : (
              <Chip icon="alert" className="border-rag-amber-border bg-rag-amber-bg text-rag-amber">
                Not configured — messages are spooled
              </Chip>
            )}
          </div>
        </div>

        {readOnly && (
          <div
            role="status"
            className="flex items-start gap-2 border-b border-line bg-surface-muted px-4 py-3 text-xs text-ink sm:px-5"
          >
            <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-ink-subtle" />
            <p>
              This deployment sets the mail server in its environment, which takes precedence over
              anything entered here. These values are shown for reference only — change{" "}
              <span className="font-mono">SMTP_HOST</span> in the deployment configuration instead.
            </p>
          </div>
        )}

        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
          <Field label="Mail server" hint="Hostname or IP address of the SMTP relay." required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={readOnly}
                value={draft.host}
                onChange={(event) => set("host", event.target.value)}
                placeholder="smtp.office365.com"
                autoComplete="off"
              />
            )}
          </Field>

          <Field label="Port" hint="587 for STARTTLS, 465 for implicit SSL.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                disabled={readOnly}
                value={draft.port}
                onChange={(event) => set("port", event.target.value)}
                inputMode="numeric"
                placeholder="587"
              />
            )}
          </Field>

          <Field label="Username" hint="Leave blank if the relay needs no sign-in.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                disabled={readOnly}
                value={draft.user}
                onChange={(event) => set("user", event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>

          <Field
            label="Password"
            hint={
              config.password_set && !passwordTouched
                ? "A password is stored. Leave this alone to keep it."
                : "Stored on this server. In production, set SMTP_PASSWORD in the environment instead."
            }
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="password"
                disabled={readOnly}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordTouched(true);
                }}
                placeholder={config.password_set ? "unchanged" : "Not set"}
                autoComplete="new-password"
              />
            )}
          </Field>

          <Field
            label="From address"
            hint="What recipients see in the From line."
            className="sm:col-span-2"
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={readOnly}
                type="email"
                value={draft.sender}
                onChange={(event) => set("sender", event.target.value)}
                placeholder="complytrack@yourcompany.in"
                autoComplete="off"
              />
            )}
          </Field>

          <div className="space-y-3 sm:col-span-2">
            <Switch
              checked={draft.use_tls}
              disabled={readOnly || draft.use_ssl}
              onChange={(next) => set("use_tls", next)}
              label="Upgrade with STARTTLS"
              description="Starts unencrypted on port 587 and upgrades. The usual choice."
            />
            <Switch
              checked={draft.use_ssl}
              disabled={readOnly}
              onChange={(next) => {
                set("use_ssl", next);
                // The two are mutually exclusive; the server refuses both at once.
                if (next && draft.use_tls) set("use_tls", false);
              }}
              label="Connect with implicit SSL"
              description="TLS from the first byte, normally on port 465. Supersedes STARTTLS."
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
          <Button
            variant="primary"
            icon="save"
            loading={save.isPending}
            disabled={readOnly || !draft.host.trim()}
            onClick={() => save.mutate()}
          >
            Save mail settings
          </Button>
          {!readOnly && !draft.host.trim() && (
            <p className="text-2xs text-ink-subtle">
              Enter a mail server to start sending. Clearing the host returns the engine to
              spooling.
            </p>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Section
          title="Send a test e-mail"
          description="Sends one message now and reports what the mail server actually said — the quickest way to tell a wrong password from a wrong port."
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="Send to"
              hint="Leave blank to send it to your own address."
              className="min-w-64 flex-1"
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="email"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="you@yourcompany.in"
                  autoComplete="off"
                />
              )}
            </Field>
            <Button icon="send" loading={test.isPending} onClick={() => test.mutate()}>
              Send test e-mail
            </Button>
          </div>

          {test.data && (
            <div
              role="status"
              className={
                test.data.ok
                  ? "mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-green-border bg-rag-green-bg px-3 py-2 text-xs text-ink"
                  : "mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-xs text-ink"
              }
            >
              <Icon
                name={test.data.ok ? "check-circle" : "alert-circle"}
                size={15}
                className={
                  test.data.ok ? "mt-0.5 shrink-0 text-rag-green" : "mt-0.5 shrink-0 text-rag-red"
                }
              />
              <div>
                <p className="font-medium">
                  {test.data.ok
                    ? test.data.mode === "smtp"
                      ? `Sent to ${test.data.to}`
                      : "Written to the outbox, not sent"
                    : "The message was not sent"}
                </p>
                <p className="mt-0.5 text-ink-muted">{test.data.detail}</p>
              </div>
            </div>
          )}
        </Section>
      </Card>

      <Panel title="How a reminder reaches someone" icon="info">
        <ul className="space-y-1.5 text-xs text-ink-muted">
          <li className="flex gap-2">
            <Icon name="send" size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
            Once a mail server is set, reminders go straight out and nothing lands in the outbox.
          </li>
          <li className="flex gap-2">
            <Icon name="archive" size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
            With no mail server, every message is written to{" "}
            <span className="font-mono break-all">{config.outbox_dir}</span> instead. The Outbox
            tab lists them, and any one can be opened and read.
          </li>
          <li className="flex gap-2">
            <Icon name="history" size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
            Either way the Delivery log records what the engine tried to send, to whom, and the
            result.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
