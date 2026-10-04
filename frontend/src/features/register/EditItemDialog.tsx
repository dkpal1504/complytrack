/**
 * Editing an obligation (CD-03).
 *
 * `PATCH /items/{id}` changes only the fields that are sent, so the dialog
 * works out the difference between what was loaded and what the user typed and
 * posts just that. A reason is collected whenever the change touches a date, an
 * owner or the criticality, because those are the edits the audit trail most
 * needs to explain.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { ApiError, api } from "@/lib/api";
import { invalidateRegister, queryClient } from "@/lib/query";
import { stringsToOptions, toOptions, useLookups, useMeta } from "@/features/org/useReference";
import type { ItemDetail } from "@/features/register/api-types";

interface FormState {
  name: string;
  category_id: string;
  unit_id: string;
  department_id: string;
  owner_id: string;
  delegate_id: string;
  authority_id: string;
  reference_number: string;
  issue_date: string;
  expiry_date: string;
  criticality: string;
  applicability: string;
  applicability_justification: string;
  recurrence_rule: string;
  fee_amount: string;
  penalty_per_day: string;
  grace_period_days: string;
  tags: string;
  required_documents: string;
  remarks: string;
  exposure_note: string;
  legal_reference_text: string;
  allow_direct_close: boolean;
  is_perpetual: boolean;
}

/** The fields a change to which the API expects a reason for. */
const REASON_FIELDS: (keyof FormState)[] = [
  "owner_id",
  "delegate_id",
  "criticality",
  "issue_date",
  "expiry_date",
];

function toForm(item: ItemDetail): FormState {
  return {
    name: item.name,
    category_id: item.category_id ?? "",
    unit_id: item.unit_id ?? "",
    department_id: item.department_id ?? "",
    owner_id: item.owner_id ?? "",
    delegate_id: item.delegate_id ?? "",
    authority_id: item.authority_id ?? "",
    reference_number: item.reference_number ?? "",
    issue_date: item.issue_date ?? "",
    expiry_date: item.expiry_date ?? "",
    criticality: item.criticality,
    applicability: item.applicability ?? "",
    applicability_justification: item.applicability_justification ?? "",
    recurrence_rule: item.recurrence_rule ?? "",
    fee_amount: item.fee_amount === null ? "" : String(item.fee_amount),
    penalty_per_day: item.penalty_per_day === null ? "" : String(item.penalty_per_day),
    grace_period_days: item.grace_period_days === null ? "" : String(item.grace_period_days),
    tags: (item.tags ?? []).join(", "),
    required_documents: (item.required_documents ?? []).join(", "),
    remarks: item.remarks ?? "",
    exposure_note: item.exposure_note ?? "",
    legal_reference_text: item.legal_reference_text ?? "",
    allow_direct_close: item.allow_direct_close,
    is_perpetual: item.is_perpetual,
  };
}

export interface EditItemDialogProps {
  open: boolean;
  item: ItemDetail;
  onClose: () => void;
  onSaved?: () => void;
}

export function EditItemDialog({ open, item, onClose, onSaved }: EditItemDialogProps) {
  const toast = useToast();
  const meta = useMeta();
  const lookups = useLookups(open);

  // The snapshot the form is editing. The parent keys this dialog on the item's
  // `updated_at`, so a change landing underneath (a workflow move, a saved edit)
  // remounts it with fresh values rather than leaving a stale diff behind.
  const [base] = useState<FormState>(() => toForm(item));
  const [form, setForm] = useState<FormState>(base);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const close = () => {
    if (save.isPending) return;
    setReason("");
    setErrors({});
    setFormError(null);
    onClose();
  };

  const listOf = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const save = useMutation({
    mutationFn: () => {
      const json: Record<string, unknown> = {};
      const put = <K extends keyof FormState>(key: K, value: unknown) => {
        if (form[key] !== base[key]) json[key] = value;
      };

      put("name", form.name.trim());
      put("category_id", form.category_id || null);
      put("unit_id", form.unit_id || null);
      put("department_id", form.department_id || null);
      put("owner_id", form.owner_id || null);
      put("delegate_id", form.delegate_id || null);
      put("authority_id", form.authority_id || null);
      put("reference_number", form.reference_number.trim() || null);
      put("issue_date", form.issue_date || null);
      put("expiry_date", form.expiry_date || null);
      put("criticality", form.criticality || undefined);
      put("applicability", form.applicability || undefined);
      put("applicability_justification", form.applicability_justification.trim() || null);
      put("recurrence_rule", form.recurrence_rule || undefined);
      put("fee_amount", form.fee_amount ? Number(form.fee_amount) : null);
      put("penalty_per_day", form.penalty_per_day ? Number(form.penalty_per_day) : null);
      put("grace_period_days", form.grace_period_days ? Number(form.grace_period_days) : null);
      put("tags", listOf(form.tags));
      put("required_documents", listOf(form.required_documents));
      put("remarks", form.remarks.trim() || null);
      put("exposure_note", form.exposure_note.trim() || null);
      put("legal_reference_text", form.legal_reference_text.trim() || null);
      put("allow_direct_close", form.allow_direct_close);
      put("is_perpetual", form.is_perpetual);

      if (reason.trim()) json.reason = reason.trim();
      return api(`/items/${item.id}`, { method: "PATCH", json });
    },
    onSuccess: () => {
      toast.success("Obligation updated", `${item.item_code} has been saved.`);
      invalidateRegister(queryClient);
      onSaved?.();
      setReason("");
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        setFormError(error.detail);
      } else {
        setFormError("The changes could not be saved.");
      }
    },
  });

  const touchedReason = REASON_FIELDS.filter((key) => form[key] !== base[key]).map((key) =>
    key.replace(/_id$/, "").replace(/_/g, " "),
  );
  const reasonNeeded = touchedReason.length > 0;
  const canSubmit =
    form.name.trim().length >= 2 && (!reasonNeeded || reason.trim().length >= 3) && !save.isPending;

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Edit ${item.item_code}`}
      description="Only the fields you change are written, and each one is recorded on the audit trail."
      size="lg"
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={close} disabled={save.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="save"
            onClick={() => save.mutate()}
            disabled={!canSubmit}
            loading={save.isPending}
            block
            className="sm:w-auto"
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Obligation name" required error={errors.name}>
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.category_id}
                onChange={(event) => set("category_id", event.target.value)}
                placeholder="Uncategorised"
                options={toOptions(lookups.data?.categories)}
              />
            )}
          </Field>
          <Field label="Authority">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.authority_id}
                onChange={(event) => set("authority_id", event.target.value)}
                placeholder="Not recorded"
                options={toOptions(lookups.data?.authorities)}
              />
            )}
          </Field>
          <Field label="Unit">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.unit_id}
                onChange={(event) => set("unit_id", event.target.value)}
                placeholder="Not unit-specific"
                options={toOptions(lookups.data?.units, { withCode: true })}
              />
            )}
          </Field>
          <Field label="Department">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.department_id}
                onChange={(event) => set("department_id", event.target.value)}
                placeholder="Unassigned"
                options={toOptions(lookups.data?.departments)}
              />
            )}
          </Field>
          <Field label="Owner">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.owner_id}
                onChange={(event) => set("owner_id", event.target.value)}
                placeholder="Unassigned"
                options={toOptions(lookups.data?.users)}
              />
            )}
          </Field>
          <Field label="Delegate">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.delegate_id}
                onChange={(event) => set("delegate_id", event.target.value)}
                placeholder="No delegate"
                options={toOptions(lookups.data?.users)}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reference number">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={form.reference_number}
                onChange={(event) => set("reference_number", event.target.value)}
              />
            )}
          </Field>
          <Field label="Criticality">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.criticality}
                onChange={(event) => set("criticality", event.target.value)}
                options={stringsToOptions(meta.data?.criticality)}
              />
            )}
          </Field>
          <Field label="Issue date">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="date"
                value={form.issue_date}
                onChange={(event) => set("issue_date", event.target.value)}
              />
            )}
          </Field>
          <Field label="Expiry date" hint="Changing this moves every countdown on the register">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="date"
                value={form.expiry_date}
                disabled={form.is_perpetual}
                onChange={(event) => set("expiry_date", event.target.value)}
              />
            )}
          </Field>
          <Field label="Applicability">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.applicability}
                onChange={(event) => set("applicability", event.target.value)}
                options={stringsToOptions(meta.data?.applicability)}
              />
            )}
          </Field>
          <Field label="Recurrence">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.recurrence_rule}
                onChange={(event) => set("recurrence_rule", event.target.value)}
                options={stringsToOptions(meta.data?.recurrence)}
              />
            )}
          </Field>
        </div>

        <Field label="Applicability justification">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={form.applicability_justification}
              onChange={(event) => set("applicability_justification", event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Fee amount">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={0}
                value={form.fee_amount}
                onChange={(event) => set("fee_amount", event.target.value)}
              />
            )}
          </Field>
          <Field label="Penalty per day">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={0}
                value={form.penalty_per_day}
                onChange={(event) => set("penalty_per_day", event.target.value)}
              />
            )}
          </Field>
          <Field label="Grace period" hint="Days">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={0}
                value={form.grace_period_days}
                onChange={(event) => set("grace_period_days", event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Tags" hint="Comma separated">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={form.tags}
              onChange={(event) => set("tags", event.target.value)}
            />
          )}
        </Field>

        <Field label="Documents the authority expects" hint="Comma separated checklist items">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={form.required_documents}
              onChange={(event) => set("required_documents", event.target.value)}
            />
          )}
        </Field>

        <Field label="Legal reference">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={form.legal_reference_text}
              onChange={(event) => set("legal_reference_text", event.target.value)}
            />
          )}
        </Field>

        <Field label="Exposure note" hint="What a lapse would cost the plant">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={2}
              value={form.exposure_note}
              onChange={(event) => set("exposure_note", event.target.value)}
            />
          )}
        </Field>

        <Field label="Remarks">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={2}
              value={form.remarks}
              onChange={(event) => set("remarks", event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5">
            <input
              type="checkbox"
              checked={form.is_perpetual}
              onChange={(event) => set("is_perpetual", event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-600)]"
            />
            <span className="text-sm text-ink">
              Perpetual licence
              <span className="block text-2xs text-ink-subtle">Never expires; no reminders.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5">
            <input
              type="checkbox"
              checked={form.allow_direct_close}
              onChange={(event) => set("allow_direct_close", event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-600)]"
            />
            <span className="text-sm text-ink">
              Allow direct close
              <span className="block text-2xs text-ink-subtle">
                Lets a filing be closed from Submitted without the renewal leg.
              </span>
            </span>
          </label>
        </div>

        <Field
          label="Reason for the change"
          required={reasonNeeded}
          hint={
            reasonNeeded
              ? `Required — you are changing ${touchedReason.join(", ")}`
              : "Optional, but recorded on the audit trail"
          }
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Licence renewed on the PCB portal; new expiry recorded."
            />
          )}
        </Field>

        {formError && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
            {formError}
          </p>
        )}
      </div>
    </Modal>
  );
}
