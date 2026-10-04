/**
 * Creating one obligation by hand (CD-01).
 *
 * The API's `ItemCreate` carries forty fields; this form asks for the ones a
 * compliance officer has to hand when they open a new licence file. Everything
 * else — reminder profiles, escalation profiles, lead times — either has a
 * sensible server default or is more comfortably edited on the detail page
 * afterwards, so the dialog says so rather than presenting a wall of inputs.
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
import type { ComplianceItemSummary } from "@/types/api";

export interface CreateItemDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (item: ComplianceItemSummary) => void;
}

const EMPTY = {
  name: "",
  type: "",
  category_id: "",
  unit_id: "",
  department_id: "",
  owner_id: "",
  authority_id: "",
  reference_number: "",
  issue_date: "",
  validity_value: "",
  validity_unit: "",
  expiry_date: "",
  criticality: "",
  recurrence_rule: "",
  applicability: "",
  applicability_justification: "",
  legal_reference_text: "",
  fee_amount: "",
  penalty_per_day: "",
  tags: "",
  required_documents: "",
  remarks: "",
  is_perpetual: false,
};

export function CreateItemDialog({ open, onClose, onCreated }: CreateItemDialogProps) {
  const toast = useToast();
  const meta = useMeta();
  const lookups = useLookups(open);

  const [form, setForm] = useState({ ...EMPTY });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const close = () => {
    if (create.isPending) return;
    setForm({ ...EMPTY });
    setErrors({});
    setFormError(null);
    onClose();
  };

  const create = useMutation({
    mutationFn: () => {
      const listOf = (value: string) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      return api<ComplianceItemSummary>("/items", {
        method: "POST",
        json: {
          name: form.name.trim(),
          type: form.type || undefined,
          category_id: form.category_id || null,
          unit_id: form.unit_id || null,
          department_id: form.department_id || null,
          owner_id: form.owner_id || null,
          authority_id: form.authority_id || null,
          reference_number: form.reference_number.trim() || null,
          issue_date: form.issue_date || null,
          validity_value: form.validity_value ? Number(form.validity_value) : null,
          validity_unit: form.validity_unit || undefined,
          expiry_date: form.expiry_date || null,
          criticality: form.criticality || undefined,
          recurrence_rule: form.recurrence_rule || undefined,
          applicability: form.applicability || undefined,
          applicability_justification: form.applicability_justification.trim() || null,
          legal_reference_text: form.legal_reference_text.trim() || null,
          fee_amount: form.fee_amount ? Number(form.fee_amount) : null,
          penalty_per_day: form.penalty_per_day ? Number(form.penalty_per_day) : null,
          tags: listOf(form.tags),
          required_documents: listOf(form.required_documents),
          remarks: form.remarks.trim() || null,
          is_perpetual: form.is_perpetual,
          create_first_instance: true,
        },
      });
    },
    onSuccess: (item) => {
      toast.success(
        "Obligation created",
        `${item.item_code} · ${item.name} is on the register with its first cycle.`,
      );
      invalidateRegister(queryClient);
      onCreated?.(item);
      close();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        setFormError(error.detail);
      } else {
        setFormError("The obligation could not be created.");
      }
    },
  });

  const canSubmit = form.name.trim().length >= 2 && !create.isPending;

  return (
    <Modal
      open={open}
      onClose={close}
      title="New obligation"
      description="Add a licence, filing, inspection or certificate to the register."
      size="lg"
      dismissible={!create.isPending}
      footer={
        <>
          <Button onClick={close} disabled={create.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="plus"
            onClick={() => create.mutate()}
            disabled={!canSubmit}
            loading={create.isPending}
            block
            className="sm:w-auto"
          >
            Create obligation
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
              placeholder="e.g. Consent to Operate — Air (CTO)"
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.type}
                onChange={(event) => set("type", event.target.value)}
                placeholder="Licence"
                options={stringsToOptions(meta.data?.item_type)}
              />
            )}
          </Field>
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
          <Field label="Unit / location">
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
          <Field label="Owner" hint="Who is answerable for it">
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
          <Field label="Issuing authority">
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
                placeholder="Medium"
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
          <Field label="Expiry date" hint="Leave blank for a perpetual licence">
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
          <Field label="Validity" hint="Used when no expiry date is given">
            {({ id, describedBy }) => (
              <div className="flex gap-2">
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={form.validity_value}
                  onChange={(event) => set("validity_value", event.target.value)}
                  placeholder="12"
                />
                <Select
                  aria-label="Validity unit"
                  value={form.validity_unit}
                  onChange={(event) => set("validity_unit", event.target.value)}
                  placeholder="Months"
                  options={stringsToOptions(meta.data?.validity_unit)}
                  className="w-36"
                />
              </div>
            )}
          </Field>
          <Field label="Recurrence">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.recurrence_rule}
                onChange={(event) => set("recurrence_rule", event.target.value)}
                placeholder="Annual"
                options={stringsToOptions(meta.data?.recurrence)}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Applicability">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.applicability}
                onChange={(event) => set("applicability", event.target.value)}
                placeholder="Applicable"
                options={stringsToOptions(meta.data?.applicability)}
              />
            )}
          </Field>
          <Field label="Justification" hint="Why it does or does not apply">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={form.applicability_justification}
                onChange={(event) => set("applicability_justification", event.target.value)}
              />
            )}
          </Field>
          <Field label="Fee amount" hint="In rupees">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={0}
                step="1"
                inputMode="decimal"
                value={form.fee_amount}
                onChange={(event) => set("fee_amount", event.target.value)}
              />
            )}
          </Field>
          <Field label="Penalty per day" hint="Exposure if it lapses">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={0}
                step="1"
                inputMode="decimal"
                value={form.penalty_per_day}
                onChange={(event) => set("penalty_per_day", event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Tags" hint="Comma separated, e.g. env, fy2026-27">
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
              placeholder="Latest consent copy, Fee challan, Site plan"
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
              placeholder="e.g. Rule 12, Air (Prevention and Control of Pollution) Rules"
            />
          )}
        </Field>

        <Field label="Remarks">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={form.remarks}
              onChange={(event) => set("remarks", event.target.value)}
              rows={2}
            />
          )}
        </Field>

        <label className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5">
          <input
            type="checkbox"
            checked={form.is_perpetual}
            onChange={(event) => set("is_perpetual", event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-600)]"
          />
          <span className="text-sm text-ink">
            Perpetual licence
            <span className="block text-2xs text-ink-subtle">
              It never expires and so never needs renewal or reminders.
            </span>
          </span>
        </label>

        <p className="text-2xs text-ink-subtle">
          A first renewal cycle is opened automatically. Reminder and escalation profiles, lead
          times and reviewer assignments can be set on the obligation's page after it is created.
        </p>

        {formError && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
            {formError}
          </p>
        )}
      </div>
    </Modal>
  );
}
