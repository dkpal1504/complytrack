/**
 * Configuration settings.
 *
 * Settings are stored as JSON, so a value can be a flag, a number, a string or
 * a whole object. The editor picks a control that matches the current value —
 * a switch for a flag, a number box for a count, a JSON editor for anything
 * structured — and never sends a JSON document it could not parse.
 *
 * `PUT /org/settings/{key}` creates the row if the key does not exist yet, so
 * the same form adds a new setting.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ErrorState, useToast } from "@/components/ui/Feedback";
import { Field, Input, SearchInput, Switch, Textarea } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Overlay";
import { ResultCount, Toolbar } from "@/components/ui/Page";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateAdmin } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import {
  parseJsonText,
  settingKind,
  settingSummary,
  toJsonText,
  type SettingKind,
} from "@/features/admin/admin-utils";
import type { SettingRow } from "@/features/admin/admin-types";

interface Draft {
  key: string;
  kind: SettingKind;
  text: string;
  flag: boolean;
  error?: string;
}

export function SettingsTab() {
  const { can } = useAuth();
  const canManage = can(PERM.MANAGE_SETTINGS);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newKey, setNewKey] = useState("");

  const query = useQuery({
    queryKey: qk.org.settings,
    queryFn: () => api<SettingRow[]>("/org/settings"),
  });

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api<SettingRow>(`/org/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        json: { value },
      }),
    onSuccess: () => {
      toast.success("Setting saved", "The change is recorded in the audit trail.");
      void queryClient.invalidateQueries({ queryKey: qk.org.settings });
      invalidateAdmin(queryClient);
      setDraft(null);
      setNewKey("");
    },
    onError: (error) => {
      toast.error(
        "Could not save the setting",
        error instanceof ApiError ? error.detail : undefined,
      );
    },
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = query.data ?? [];
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.key, row.description].filter(Boolean).some((field) =>
        field!.toLowerCase().includes(needle),
      ),
    );
  }, [query.data, search]);

  /** Turns the draft back into a JSON value, or reports why it cannot. */
  const valueFrom = (current: Draft): { value?: unknown; error?: string } => {
    switch (current.kind) {
      case "boolean":
        return { value: current.flag };
      case "number": {
        const trimmed = current.text.trim();
        if (!trimmed) return { value: null };
        const parsed = Number(trimmed);
        return Number.isFinite(parsed)
          ? { value: parsed }
          : { error: "Enter a number, or clear the box to remove the value." };
      }
      case "string":
        return { value: current.text };
      default:
        return parseJsonText(current.text);
    }
  };

  const submit = () => {
    if (!draft) return;
    const parsed = valueFrom(draft);
    if (parsed.error) {
      setDraft({ ...draft, error: parsed.error });
      return;
    }
    save.mutate({ key: draft.key, value: parsed.value });
  };

  const openEditor = (row: SettingRow) => {
    setDraft({
      key: row.key,
      kind: settingKind(row.value),
      text: typeof row.value === "string" ? row.value : toJsonText(row.value),
      flag: row.value === true,
    });
  };

  const openNew = () => {
    const key = newKey.trim();
    if (!key) return;
    setDraft({ key, kind: "json", text: "", flag: false });
  };

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Settings</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              These values change how the register behaves for everyone. Every save is recorded in
              the audit trail.
            </p>
          </div>
        </div>

        <Toolbar label="Setting filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search settings…"
            className="sm:w-80"
          />
          <ResultCount shown={filtered.length} total={query.data?.length ?? 0} noun="setting" />
          {canManage && (
            <div className="flex items-end gap-2 sm:ml-auto">
              <Field label="New setting key">
                {({ id }) => (
                  <Input
                    id={id}
                    value={newKey}
                    onChange={(event) => setNewKey(event.target.value)}
                    placeholder="e.g. reminder.batch_size"
                    className="sm:w-64"
                  />
                )}
              </Field>
              <Button icon="plus" onClick={openNew} disabled={!newKey.trim()}>
                Add or replace
              </Button>
            </div>
          )}
        </Toolbar>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">Loading settings…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            {search ? "No setting matches that search." : "No settings have been created yet."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((row) => {
              const kind = settingKind(row.value);
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold text-ink">{row.key}</p>
                    {row.description && (
                      <p className="mt-0.5 text-2xs text-ink-muted">{row.description}</p>
                    )}
                    {kind !== "boolean" && (
                      <p className="mt-1 truncate text-xs text-ink-muted">
                        {settingSummary(row.value)}
                      </p>
                    )}
                  </div>
                  <Chip className="shrink-0">{kind === "null" ? "not set" : kind}</Chip>
                  {canManage ? (
                    kind === "boolean" ? (
                      <Switch
                        checked={row.value === true}
                        disabled={save.isPending}
                        onChange={(next) => save.mutate({ key: row.key, value: next })}
                        label={<span className="sr-only">{`Toggle ${row.key}`}</span>}
                      />
                    ) : (
                      <Button
                        size="sm"
                        icon="edit"
                        onClick={() => openEditor(row)}
                        aria-label={`Edit ${row.key}`}
                      >
                        Edit
                      </Button>
                    )
                  ) : (
                    <span className="text-2xs text-ink-subtle">Read only</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft ? `Edit ${draft.key}` : "Edit setting"}
        description="The value is stored as JSON. Numbers and text are saved with their own type."
        footer={
          <>
            <Button onClick={() => setDraft(null)} className="sm:w-auto" block>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="save"
              onClick={submit}
              loading={save.isPending}
              className="sm:w-auto"
              block
            >
              Save setting
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2">
              <p className="font-mono text-xs font-semibold text-ink">{draft.key}</p>
            </div>
            {draft.kind === "boolean" ? (
              <Switch
                checked={draft.flag}
                onChange={(next) => setDraft({ ...draft, flag: next, error: undefined })}
                label="Enabled"
              />
            ) : draft.kind === "number" ? (
              <Field label="Value" error={draft.error}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    type="number"
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={draft.text}
                    onChange={(event) =>
                      setDraft({ ...draft, text: event.target.value, error: undefined })
                    }
                  />
                )}
              </Field>
            ) : draft.kind === "string" ? (
              <Field label="Value" error={draft.error}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={draft.text}
                    onChange={(event) =>
                      setDraft({ ...draft, text: event.target.value, error: undefined })
                    }
                  />
                )}
              </Field>
            ) : (
              <Field
                label="Value (JSON)"
                error={draft.error}
                hint="Leave empty to remove the value."
              >
                {({ id, describedBy, invalid }) => (
                  <Textarea
                    id={id}
                    rows={8}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    className="font-mono text-xs"
                    value={draft.text}
                    onChange={(event) =>
                      setDraft({ ...draft, text: event.target.value, error: undefined })
                    }
                  />
                )}
              </Field>
            )}
            {draft.kind === "json" || draft.kind === "null" ? (
              <p className="flex items-start gap-1.5 text-2xs text-ink-subtle">
                <Icon name="info" size={13} className="mt-0.5 shrink-0" />
                A malformed document is not sent — the field shows the parse error instead.
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
