/**
 * Reminder profiles (RM-01, RM-03).
 *
 * A profile is the schedule: which day offsets trigger a reminder, which
 * channels carry it, and who receives it at each offset. The offsets are signed
 * — a positive number counts down to the due date, a negative one counts the
 * days a reminder keeps firing after it has passed.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card, Section } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ErrorState, useToast } from "@/components/ui/Feedback";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Overlay";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateAdmin } from "@/lib/query";
import { NumberListEditor } from "@/features/admin/admin-controls";
import {
  ANCHOR_OPTIONS,
  CHANNELS,
  DELIVERING_CHANNELS,
  RECIPIENT_ROLES,
  offsetLabel,
  roleLabel,
} from "@/features/admin/admin-utils";
import type { ReminderProfileRow } from "@/features/admin/admin-types";

interface FormState {
  name: string;
  offsets: number[];
  channels: string[];
  recipients: Record<string, string[]>;
  post_expiry_frequency_days: string;
  anchor_on: string;
  quiet_hours_exempt: boolean;
  is_default: boolean;
}

const EMPTY: FormState = {
  name: "",
  offsets: [90, 60, 30, 15, 7, 3, 1, 0],
  channels: ["email", "in_app", "push"],
  recipients: {},
  post_expiry_frequency_days: "2",
  anchor_on: "renewal_due_date",
  quiet_hours_exempt: false,
  is_default: false,
};

export function ReminderProfilesTab() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReminderProfileRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: qk.reminders.profiles,
    queryFn: () => api<ReminderProfileRow[]>("/reminders/profiles"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api<ReminderProfileRow>(`/reminders/profiles/${editing.id}`, {
            method: "PATCH",
            json: payload,
          })
        : api<ReminderProfileRow>("/reminders/profiles", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success(editing ? "Profile updated" : "Profile created");
      void queryClient.invalidateQueries({ queryKey: qk.reminders.profiles });
      invalidateAdmin(queryClient);
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not save the profile", error.detail);
      } else {
        toast.error("Could not save the profile");
      }
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setErrors({});
    setOpen(true);
  };

  const openEdit = (row: ReminderProfileRow) => {
    setEditing(row);
    setForm({
      name: row.name,
      offsets: [...row.offsets].sort((a, b) => b - a),
      channels: row.channels,
      recipients: Object.fromEntries(
        Object.entries(row.recipients_by_offset ?? {}).map(([key, roles]) => [key, [...roles]]),
      ),
      post_expiry_frequency_days: String(row.post_expiry_frequency_days),
      anchor_on: row.anchor_on,
      quiet_hours_exempt: row.quiet_hours_exempt,
      is_default: row.is_default,
    });
    setErrors({});
    setOpen(true);
  };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "Give the profile a name.";
    if (form.offsets.length === 0) nextErrors.offsets = "Add at least one day offset.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      offsets: form.offsets,
      channels: form.channels,
      recipients_by_offset: form.recipients,
      post_expiry_frequency_days: Number(form.post_expiry_frequency_days) || 1,
      anchor_on: form.anchor_on,
      quiet_hours_exempt: form.quiet_hours_exempt,
    };
    // `is_default` is only accepted on create; the update schema omits it.
    if (!editing) payload.is_default = form.is_default;
    mutation.mutate(payload);
  };

  const toggleChannel = (channel: string, checked: boolean) =>
    setForm((current) => ({
      ...current,
      channels: checked
        ? [...current.channels, channel]
        : current.channels.filter((value) => value !== channel),
    }));

  const setMapping = (offset: number, roles: string[] | null) =>
    setForm((current) => {
      const next = { ...current.recipients };
      if (roles === null) delete next[String(offset)];
      else next[String(offset)] = roles;
      return { ...current, recipients: next };
    });

  const toggleRole = (offset: number, role: string, checked: boolean) => {
    const existing = form.recipients[String(offset)] ?? [];
    setMapping(
      offset,
      checked ? [...existing, role] : existing.filter((value) => value !== role),
    );
  };

  const rows = query.data ?? [];

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Reminder profiles</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              Each obligation uses the profile that matches its criticality. The first profile
              marked as the default catches everything else.
            </p>
          </div>
          <Button variant="primary" icon="plus" size="sm" onClick={openCreate}>
            New profile
          </Button>
        </div>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">Loading profiles…</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            No reminder profiles have been configured. Without one, the engine has no schedule to
            follow.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{row.name}</p>
                      {row.is_default && (
                        <Chip icon="check" title="Catch-all profile">
                          Default
                        </Chip>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {row.offsets.length === 0
                        ? "No offsets — this profile sends nothing."
                        : row.offsets.map((offset) => offsetLabel(offset)).join(", ")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {row.channels.map((channel) => (
                        <Chip key={channel} icon="send">
                          {CHANNELS.find((entry) => entry.key === channel)?.label ?? channel}
                        </Chip>
                      ))}
                    </div>
                    {Object.keys(row.recipients_by_offset ?? {}).length > 0 && (
                      <p className="mt-1.5 text-2xs text-ink-subtle">
                        Custom recipients at{" "}
                        {Object.entries(row.recipients_by_offset)
                          .map(([offset, roles]) => `${offsetLabel(Number(offset))}: ${roles.map(roleLabel).join(", ")}`)
                          .join("; ")}
                      </p>
                    )}
                  </div>
                  <Button size="sm" icon="edit" onClick={() => openEdit(row)} aria-label={`Edit ${row.name}`}>
                    Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={editing ? "Edit reminder profile" : "New reminder profile"}
        description="Offsets are days before the due date; negative offsets keep firing after it."
        footer={
          <>
            <Button onClick={() => setOpen(false)} className="sm:w-auto" block>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="save"
              onClick={submit}
              loading={mutation.isPending}
              className="sm:w-auto"
              block
            >
              {editing ? "Save changes" : "Create profile"}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <Section title="Schedule">
            <Field label="Profile name" required error={errors.name}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="e.g. Critical licences"
                />
              )}
            </Field>

            <div>
              <NumberListEditor
                label="Reminder offsets (days)"
                hint="90 = 90 days before the due date"
                values={form.offsets}
                onChange={(next) => setForm({ ...form, offsets: next })}
                placeholder="e.g. 30"
              />
              {errors.offsets && (
                <p role="alert" className="mt-1 text-xs text-rag-red">
                  {errors.offsets}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reminders count down to">
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.anchor_on}
                    options={ANCHOR_OPTIONS}
                    onChange={(event) => setForm({ ...form, anchor_on: event.target.value })}
                  />
                )}
              </Field>
              <Field
                label="After the due date, repeat every (days)"
                hint="How often an overdue reminder fires"
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    value={form.post_expiry_frequency_days}
                    onChange={(event) =>
                      setForm({ ...form, post_expiry_frequency_days: event.target.value })
                    }
                  />
                )}
              </Field>
            </div>

            <fieldset>
              <legend className="text-xs font-semibold text-ink">Channels</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {CHANNELS.map((channel) => {
                  const available = DELIVERING_CHANNELS.has(channel.key);
                  return (
                    <Checkbox
                      key={channel.key}
                      label={
                        <span className="flex items-center gap-1.5">
                          {channel.label}
                          {!available && <Chip>Phase 2</Chip>}
                        </span>
                      }
                      checked={form.channels.includes(channel.key)}
                      disabled={!available}
                      onChange={(event) => toggleChannel(channel.key, event.target.checked)}
                    />
                  );
                })}
              </div>
              <p className="mt-1.5 text-2xs text-ink-subtle">
                SMS, WhatsApp and Teams are not delivered by this build; they are accepted by the
                engine but marked for phase 2.
              </p>
            </fieldset>

            <Switch
              checked={form.quiet_hours_exempt}
              onChange={(next) => setForm({ ...form, quiet_hours_exempt: next })}
              label="Ignore quiet hours"
              description="Critical obligations are allowed to wake people up. Use sparingly."
            />
            {!editing && (
              <Switch
                checked={form.is_default}
                onChange={(next) => setForm({ ...form, is_default: next })}
                label="Make this the default profile"
                description="Applied to obligations whose criticality has no profile of its own."
              />
            )}
            {editing && form.is_default && (
              <p className="flex items-start gap-1.5 text-2xs text-ink-subtle">
                <Icon name="info" size={13} className="mt-0.5 shrink-0" />
                This is the default profile. Which profile is the default cannot be changed after it
                is created.
              </p>
            )}
          </Section>

          <Section
            title="Recipients by offset"
            description="Leave a row on the default ladder to let the engine widen the audience as the date approaches."
          >
            {form.offsets.length === 0 ? (
              <p className="text-xs text-ink-muted">Add an offset above to set its recipients.</p>
            ) : (
              <ul className="space-y-2">
                {[...form.offsets].sort((a, b) => b - a).map((offset) => {
                  const mapped = form.recipients[String(offset)] !== undefined;
                  const roles = form.recipients[String(offset)] ?? [];
                  return (
                    <li
                      key={offset}
                      className="rounded-[var(--radius-control)] border border-line p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-ink">{offsetLabel(offset)}</p>
                        <Checkbox
                          label="Use the default ladder"
                          checked={!mapped}
                          onChange={(event) =>
                            setMapping(offset, event.target.checked ? null : ["owner", "delegate"])
                          }
                        />
                      </div>
                      {mapped && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {RECIPIENT_ROLES.map((role) => {
                            const active = roles.includes(role.key);
                            return (
                              <button
                                key={role.key}
                                type="button"
                                aria-pressed={active}
                                onClick={() => toggleRole(offset, role.key, !active)}
                                className={
                                  active
                                    ? "rounded-full border border-brand-600 bg-brand-600 px-2.5 py-1 text-2xs font-medium text-white"
                                    : "rounded-full border border-line-strong bg-surface px-2.5 py-1 text-2xs font-medium text-ink-muted hover:text-ink"
                                }
                              >
                                {role.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </Modal>
    </>
  );
}
