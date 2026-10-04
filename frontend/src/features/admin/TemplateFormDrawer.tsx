/**
 * Create or edit one obligation template.
 *
 * The template is the definition the register is instantiated from (CD-01): it
 * carries the validity, the reminder lead times and the documents the renewal
 * needs, so getting it right here sets the working dates for every obligation
 * created from it.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { SkeletonRows, useToast } from "@/components/ui/Feedback";
import { Drawer } from "@/components/ui/Overlay";
import { Section } from "@/components/ui/Card";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query";
import { categoryLabel, flattenCategories, ANCHOR_OPTIONS } from "@/features/admin/admin-utils";
import { StringListEditor } from "@/features/admin/admin-controls";
import type { CategoryRow, TemplateDetail } from "@/features/admin/admin-types";
import { useMeta, useLookups, toOptions, stringsToOptions } from "@/features/org/useReference";

interface FormState {
  code: string;
  name: string;
  category_id: string;
  sub_category_id: string;
  type: string;
  criticality: string;
  authority_id: string;
  legal_reference_text: string;
  default_validity_value: string;
  default_validity_unit: string;
  recurrence_rule: string;
  recurrence_day: string;
  recurrence_interval_months: string;
  lead_time_days: string;
  authority_processing_days: string;
  internal_prep_days: string;
  default_owner_dept_id: string;
  required_documents: string[];
  applicability_notes: string;
  allow_direct_close: boolean;
  anchor_on: string;
}

const EMPTY: FormState = {
  code: "",
  name: "",
  category_id: "",
  sub_category_id: "",
  type: "Licence",
  criticality: "Medium",
  authority_id: "",
  legal_reference_text: "",
  default_validity_value: "",
  default_validity_unit: "months",
  recurrence_rule: "annual",
  recurrence_day: "",
  recurrence_interval_months: "",
  lead_time_days: "90",
  authority_processing_days: "15",
  internal_prep_days: "15",
  default_owner_dept_id: "",
  required_documents: [],
  applicability_notes: "",
  allow_direct_close: false,
  anchor_on: "renewal_due_date",
};

const numberOrNull = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const numberOr = (value: string, fallback: number) => numberOrNull(value) ?? fallback;

export function TemplateFormDrawer({
  open,
  onClose,
  templateId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` for a new template, an id to edit. */
  templateId: string | null;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const meta = useMeta();
  const lookups = useLookups(open);
  const categories = useQuery({
    queryKey: qk.org.categories,
    queryFn: () => api<CategoryRow[]>("/org/categories"),
    enabled: open,
  });

  const isEdit = templateId !== null;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const detail = useQuery({
    queryKey: qk.templates.detail(templateId ?? "new"),
    queryFn: () => api<TemplateDetail>(`/templates/${templateId}`),
    enabled: open && isEdit,
  });

  useEffect(() => {
    if (!open) {
      setForm(EMPTY);
      setErrors({});
      return;
    }
    if (!isEdit) {
      setForm(EMPTY);
      return;
    }
    if (!detail.data) return;
    const row = detail.data;
    setForm({
      code: row.code,
      name: row.name,
      category_id: row.category_id ?? "",
      sub_category_id: row.sub_category_id ?? "",
      type: row.type,
      criticality: row.criticality,
      authority_id: row.authority_id ?? "",
      legal_reference_text: row.legal_reference_text ?? "",
      default_validity_value: row.default_validity_value?.toString() ?? "",
      default_validity_unit: row.default_validity_unit,
      recurrence_rule: row.recurrence_rule,
      recurrence_day: row.recurrence_day?.toString() ?? "",
      recurrence_interval_months: row.recurrence_interval_months?.toString() ?? "",
      lead_time_days: String(row.lead_time_days),
      authority_processing_days: String(row.authority_processing_days),
      internal_prep_days: String(row.internal_prep_days),
      default_owner_dept_id: row.default_owner_dept_id ?? "",
      required_documents: row.required_documents ?? [],
      applicability_notes: row.applicability_notes ?? "",
      allow_direct_close: row.allow_direct_close,
      anchor_on: row.anchor_on,
    });
  }, [open, isEdit, detail.data]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? api<{ id: string }>(`/templates/${templateId}`, { method: "PATCH", json: payload })
        : api<{ id: string }>("/templates", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success(
        isEdit ? "Template updated" : "Template created",
        "The change is recorded in the audit trail.",
      );
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
      onSaved();
      onClose();
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

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "Give the template a name.";
    if (!isEdit && !form.code.trim()) nextErrors.code = "A template code is required.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      type: form.type,
      authority_id: form.authority_id || null,
      default_validity_value: numberOrNull(form.default_validity_value),
      default_validity_unit: form.default_validity_unit,
      recurrence_rule: form.recurrence_rule,
      recurrence_day: numberOrNull(form.recurrence_day),
      recurrence_interval_months: numberOrNull(form.recurrence_interval_months),
      lead_time_days: numberOr(form.lead_time_days, 90),
      authority_processing_days: numberOr(form.authority_processing_days, 15),
      internal_prep_days: numberOr(form.internal_prep_days, 15),
      default_owner_dept_id: form.default_owner_dept_id || null,
      criticality: form.criticality,
      required_documents: form.required_documents,
      allow_direct_close: form.allow_direct_close,
      anchor_on: form.anchor_on,
      applicability_notes: form.applicability_notes.trim() || null,
      legal_reference_text: form.legal_reference_text.trim() || null,
    };
    if (!isEdit) {
      payload.code = form.code.trim();
      payload.sub_category_id = form.sub_category_id || null;
    }
    mutation.mutate(payload);
  };

  const categoryOptions = flattenCategories(categories.data ?? []).map((item) => ({
    value: item.id,
    label: `${"— ".repeat(item.depth)}${categoryLabel(item)}`,
  }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="xl"
      title={isEdit ? "Edit template" : "New obligation template"}
      description={
        isEdit
          ? "Changes apply to obligations created from now on, not to cycles already running."
          : "Templates are the library the register is instantiated from."
      }
      footer={
        <>
          <Button onClick={onClose} className="sm:w-auto" block>
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
            {isEdit ? "Save changes" : "Create template"}
          </Button>
        </>
      }
    >
      {isEdit && detail.isPending ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="space-y-6">
          <Section title="Identity" description="How the template is found in the library.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Template code" required={!isEdit} error={errors.code}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={form.code}
                    disabled={isEdit}
                    onChange={(event) => set("code", event.target.value)}
                    placeholder="FAC-001"
                  />
                )}
              </Field>
              <Field label="Name" required error={errors.name}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={form.name}
                    onChange={(event) => set("name", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Category">
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={form.category_id}
                    placeholder="No category"
                    options={categoryOptions}
                    onChange={(event) => set("category_id", event.target.value)}
                  />
                )}
              </Field>
              {!isEdit && (
                <Field
                  label="Sub-category"
                  hint="Cannot be changed after creation"
                >
                  {({ id, describedBy }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      value={form.sub_category_id}
                      placeholder="No sub-category"
                      options={categoryOptions}
                      onChange={(event) => set("sub_category_id", event.target.value)}
                    />
                  )}
                </Field>
              )}
              <Field label="Obligation type">
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.type}
                    options={stringsToOptions(meta.data?.item_type)}
                    onChange={(event) => set("type", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Criticality">
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.criticality}
                    options={stringsToOptions(meta.data?.criticality)}
                    onChange={(event) => set("criticality", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Issuing authority">
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.authority_id}
                    placeholder="No authority"
                    options={toOptions(lookups.data?.authorities, { withCode: false })}
                    onChange={(event) => set("authority_id", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Default owner department">
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.default_owner_dept_id}
                    placeholder="No default department"
                    options={toOptions(lookups.data?.departments)}
                    onChange={(event) => set("default_owner_dept_id", event.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Legal reference text" hint="The Act, rule or section that requires this.">
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={2}
                  value={form.legal_reference_text}
                  onChange={(event) => set("legal_reference_text", event.target.value)}
                />
              )}
            </Field>
          </Section>

          <Section
            title="Validity & working dates"
            description="These drive the renewal date and when preparation must start."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Validity">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    value={form.default_validity_value}
                    onChange={(event) => set("default_validity_value", event.target.value)}
                    placeholder="e.g. 12"
                  />
                )}
              </Field>
              <Field label="Validity unit">
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.default_validity_unit}
                    options={stringsToOptions(meta.data?.validity_unit)}
                    onChange={(event) => set("default_validity_unit", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Reminder lead time (days)">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    value={form.lead_time_days}
                    onChange={(event) => set("lead_time_days", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Recurrence">
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.recurrence_rule}
                    options={stringsToOptions(meta.data?.recurrence)}
                    onChange={(event) => set("recurrence_rule", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Recurrence day" hint="Day of the month, if fixed">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={31}
                    value={form.recurrence_day}
                    onChange={(event) => set("recurrence_day", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Interval (months)" hint="Only for the interval rule">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    value={form.recurrence_interval_months}
                    onChange={(event) => set("recurrence_interval_months", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Authority processing (days)">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    value={form.authority_processing_days}
                    onChange={(event) => set("authority_processing_days", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Internal preparation (days)">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    value={form.internal_prep_days}
                    onChange={(event) => set("internal_prep_days", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Reminders count down to">
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.anchor_on}
                    options={ANCHOR_OPTIONS}
                    onChange={(event) => set("anchor_on", event.target.value)}
                  />
                )}
              </Field>
            </div>
          </Section>

          <Section title="Documents & applicability">
            <StringListEditor
              label="Required documents"
              hint="Shown as a checklist on every renewal cycle."
              values={form.required_documents}
              onChange={(next) => set("required_documents", next)}
              placeholder="e.g. Fee challan"
            />
            <Field label="Applicability notes" hint="When is this template appropriate?">
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={3}
                  value={form.applicability_notes}
                  onChange={(event) => set("applicability_notes", event.target.value)}
                />
              )}
            </Field>
            <Checkbox
              label="Allow direct close"
              description="Filings may go straight from Submitted to Closed without a renewal certificate."
              checked={form.allow_direct_close}
              onChange={(event) => set("allow_direct_close", event.target.checked)}
            />
          </Section>

          {isEdit && detail.data?.is_seed && (
            <div className="rounded-[var(--radius-card)] border border-line bg-surface-muted p-3 text-xs text-ink-muted">
              This is a seeded library template, shipped with ComplyTrack. Editing it changes the
              library every unit instantiates from.
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
