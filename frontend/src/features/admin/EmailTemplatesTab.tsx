/**
 * Reminder e-mail templates (RM-07, RM-11).
 *
 * The wording of every reminder, with the placeholders the renderer understands
 * spelled out. The list carries the shared placeholder set from the API; each
 * template also says which of them it actually uses, so a template that never
 * mentions `{Days Left}` is visible as one.
 *
 * The API accepts subject, body_html and body_text — the code and the channel a
 * template belongs to are fixed at seed time.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card, Section } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, useToast } from "@/components/ui/Feedback";
import { Field, Input, SearchInput, Textarea } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Overlay";
import { SegmentedControl } from "@/components/ui/Nav";
import { Toolbar, ResultCount } from "@/components/ui/Page";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateAdmin } from "@/lib/query";
import { CHANNELS } from "@/features/admin/admin-utils";
import type { EmailTemplateRow } from "@/features/admin/admin-types";

interface FormState {
  subject: string;
  body_html: string;
  body_text: string;
}

/** Values used only by the on-screen preview — never sent to the API. */
const SAMPLE: Record<string, string> = {
  Greeting: "Hello Ramesh,",
  Item: "Factory Licence — Unit 3",
  "Reference No.": "FL/2026/0042",
  Authority: "Gujarat Pollution Control Board",
  Unit: "Vatva Plant",
  Department: "Environment",
  "Expiry Date": "31 Dec 2026",
  "Renewal Due Date": "15 Dec 2026",
  "Due Date": "15 Dec 2026",
  Status: "Renewal Due",
  Owner: "Ramesh Patel",
  "Days Left": "12",
  "Days Overdue": "0",
  Criticality: "Critical",
  Cycle: "Annual 2026",
  "Documents Pending": "2",
  "Next Escalation Date": "08 Dec 2026",
  "Next Escalation Level": "Department Head",
  Link: "https://complytrack.local/items/…",
  "Exposure Note": "Late renewal attracts a penalty under Section 25.",
};

/** Replaces `{Placeholder}` tokens with sample values for the preview. */
function renderPreview(text: string): string {
  return text.replace(/\{([^}]+)\}/g, (match, name: string) => SAMPLE[name.trim()] ?? match);
}

const PLACEHOLDER_PATTERN = /\{([^}]+)\}/g;

/** The placeholder names a template actually uses. */
function usedPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    found.add(match[1].trim());
  }
  return [...found];
}

export function EmailTemplatesTab() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [editing, setEditing] = useState<EmailTemplateRow | null>(null);
  const [form, setForm] = useState<FormState>({ subject: "", body_html: "", body_text: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<"visual" | "text">("visual");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: qk.reminders.templates,
    queryFn: () => api<EmailTemplateRow[]>("/reminders/templates"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<EmailTemplateRow>(`/reminders/templates/${editing?.id}`, {
        method: "PATCH",
        json: payload,
      }),
    onSuccess: () => {
      toast.success("Template updated", "The next reminder will use the new wording.");
      void queryClient.invalidateQueries({ queryKey: qk.reminders.templates });
      invalidateAdmin(queryClient);
      setEditing(null);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not save the template", error.detail);
      } else {
        toast.error("Could not save the template");
      }
    },
  });

  const openEdit = (row: EmailTemplateRow) => {
    setEditing(row);
    setForm({
      subject: row.subject,
      body_html: row.body_html,
      body_text: row.body_text ?? "",
    });
    setErrors({});
    setPreview("visual");
  };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.subject.trim()) nextErrors.subject = "A subject line is required.";
    if (!form.body_html.trim()) nextErrors.body_html = "The HTML body cannot be empty.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const payload: Record<string, unknown> = {
      subject: form.subject.trim(),
      body_html: form.body_html,
      body_text: form.body_text.trim() ? form.body_text : null,
    };
    mutation.mutate(payload);
  };

  const insertPlaceholder = (name: string) => {
    const token = `{${name}}`;
    setForm((current) => ({ ...current, body_html: `${current.body_html}${token}` }));
  };

  const rows = (query.data ?? []).filter((row) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      row.name.toLowerCase().includes(needle) ||
      row.code.toLowerCase().includes(needle) ||
      row.subject.toLowerCase().includes(needle)
    );
  });

  const allPlaceholders = query.data?.[0]?.placeholders ?? [];

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Message templates</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              The wording of every reminder the engine sends. Placeholders in curly braces are
              filled per obligation — a misspelt one is sent literally, so check the preview.
            </p>
          </div>
        </div>

        <Toolbar label="Template search">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search templates"
            className="sm:max-w-sm"
          />
          <ResultCount shown={rows.length} total={query.data?.length ?? 0} noun="template" className="sm:ml-auto" />
        </Toolbar>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">Loading templates…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="mail"
            title={search ? "No template matches" : "No templates configured"}
            description={
              search
                ? "Try a shorter search — the name, code and subject line are all searched."
                : "The engine has no message templates to send. They are created with the seed data."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const used = usedPlaceholders(`${row.subject}\n${row.body_html}\n${row.body_text ?? ""}`);
              const unused = allPlaceholders.filter((name) => !used.includes(name));
              return (
                <li key={row.id} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink">{row.name}</p>
                        <Chip>{row.code}</Chip>
                        <Chip icon="send">
                          {CHANNELS.find((entry) => entry.key === row.channel)?.label ?? row.channel}
                        </Chip>
                        <Chip>{row.language.toUpperCase()}</Chip>
                      </div>
                      <p className="mt-1 truncate text-xs text-ink-muted" title={row.subject}>
                        {row.subject}
                      </p>
                      <p className="mt-1.5 text-2xs text-ink-subtle">
                        {used.length === 0
                          ? "Uses no placeholders — the same wording goes to everyone."
                          : `Uses ${used.length} placeholder${used.length === 1 ? "" : "s"}.`}
                        {unused.length > 0 && ` ${unused.length} available but unused.`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      icon="edit"
                      onClick={() => openEdit(row)}
                      aria-label={`Edit ${row.name}`}
                    >
                      Edit
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        size="lg"
        title={editing ? `Edit ${editing.name}` : "Edit template"}
        description="The code, channel and language are fixed — only the wording is editable."
        footer={
          <>
            <Button onClick={() => setEditing(null)} className="sm:w-auto" block>
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
              Save template
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <Section title="Wording">
            <Field label="Subject line" required error={errors.subject}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.subject}
                  onChange={(event) => setForm({ ...form, subject: event.target.value })}
                  placeholder="e.g. {Item} expires on {Expiry Date}"
                />
              )}
            </Field>

            <Field
              label="HTML body"
              required
              error={errors.body_html}
              hint="Sent as the formatted message"
            >
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  rows={10}
                  className="font-mono text-xs"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.body_html}
                  onChange={(event) => setForm({ ...form, body_html: event.target.value })}
                />
              )}
            </Field>

            <Field
              label="Plain-text body"
              hint="Optional — used by clients that do not render HTML and as the in-app fallback"
            >
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  rows={6}
                  className="font-mono text-xs"
                  aria-describedby={describedBy}
                  value={form.body_text}
                  onChange={(event) => setForm({ ...form, body_text: event.target.value })}
                />
              )}
            </Field>
          </Section>

          <Section
            title="Available placeholders"
            description="Inserted into the HTML body at the end of the text. Use the exact spelling — an unknown token is sent as-is."
          >
            {allPlaceholders.length === 0 ? (
              <p className="text-xs text-ink-muted">The API did not report a placeholder list.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allPlaceholders.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => insertPlaceholder(name)}
                    className="rounded-full border border-line-strong bg-surface px-2.5 py-1 font-mono text-2xs text-ink-muted hover:border-brand-600 hover:text-brand-700"
                    title={`Insert {${name}} into the body`}
                  >
                    {`{${name}}`}
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section title="Preview">
            <div className="mb-2 flex items-center justify-between gap-2">
              <SegmentedControl
                options={[
                  { value: "visual", label: "Formatted" },
                  { value: "text", label: "Plain text" },
                ]}
                value={preview}
                onChange={(value) => setPreview(value as "visual" | "text")}
                label="Preview format"
              />
              <p className="flex items-center gap-1 text-2xs text-ink-subtle">
                <Icon name="info" size={12} />
                Sample values, not a real obligation
              </p>
            </div>
            <div className="rounded-[var(--radius-control)] border border-line bg-surface-muted p-3">
              <p className="border-b border-line pb-2 text-sm font-semibold text-ink">
                {renderPreview(form.subject) || "(no subject)"}
              </p>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-ink-muted">
                {renderPreview(
                  preview === "text" || !form.body_html
                    ? form.body_text || "(no plain-text body)"
                    : form.body_html.replace(/<[^>]+>/g, "").trim(),
                )}
              </pre>
            </div>
          </Section>
        </div>
      </Modal>
    </>
  );
}
