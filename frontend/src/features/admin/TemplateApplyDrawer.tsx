/**
 * Instantiate the library into the register.
 *
 * Applying a template creates a live obligation for one unit, with its first
 * renewal cycle already scheduled. The reference number and the expiry date are
 * computed by the engine from the unit code, the template code and the
 * template's validity — they are not typed in here. Always preview first: the
 * dry run shows exactly what would be created and what already exists.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Field, Input, Select } from "@/components/ui/Form";
import { EmptyState, useToast } from "@/components/ui/Feedback";
import { ConfirmDialog, Drawer } from "@/components/ui/Overlay";
import { SegmentedControl } from "@/components/ui/Nav";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateRegister } from "@/lib/query";
import { formatDate } from "@/lib/format";
import { categoryLabel, flattenCategories } from "@/features/admin/admin-utils";
import type { ApplyTemplateResult, CategoryRow, TemplateRow } from "@/features/admin/admin-types";
import { useLookups, toOptions } from "@/features/org/useReference";

type Mode = "template" | "category";

export function TemplateApplyDrawer({
  open,
  onClose,
  template,
  templates,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  /** Preselected template when opened from a row, else null. */
  template: TemplateRow | null;
  templates: TemplateRow[];
  onApplied: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const lookups = useLookups(open);
  const categoriesQuery = useQuery({
    queryKey: qk.org.categories,
    queryFn: () => api<CategoryRow[]>("/org/categories"),
    enabled: open,
  });

  const [mode, setMode] = useState<Mode>("template");
  const [templateId, setTemplateId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ApplyTemplateResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setErrors({});
      setConfirmOpen(false);
      return;
    }
    setMode(template ? "template" : "category");
    setTemplateId(template?.id ?? "");
    setCategoryId(template?.category_id ?? "");
    setUnitId("");
    setDepartmentId(template?.default_owner_dept_id ?? "");
    setOwnerId("");
    setIssueDate("");
  }, [open, template]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<ApplyTemplateResult>("/templates/apply", { method: "POST", json: payload }),
    onSuccess: (data, variables) => {
      setResult(data);
      setConfirmOpen(false);
      if (variables.dry_run) {
        toast.info(
          "Preview ready",
          `${data.created} obligation(s) would be created, ${data.skipped} already exist.`,
        );
      } else {
        toast.success(
          "Obligations created",
          `${data.created} created, ${data.skipped} skipped as duplicates.`,
        );
        void queryClient.invalidateQueries({ queryKey: ["templates"] });
        invalidateRegister(queryClient);
        onApplied();
      }
    },
    onError: (error) => {
      setConfirmOpen(false);
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not instantiate the template", error.detail);
      } else {
        toast.error("Could not instantiate the template");
      }
    },
  });

  const buildPayload = (dryRun: boolean) => ({
    unit_id: unitId,
    department_id: departmentId || null,
    owner_id: ownerId || null,
    template_ids: mode === "template" && templateId ? [templateId] : null,
    category_ids: mode === "category" && categoryId ? [categoryId] : null,
    issue_date: issueDate || null,
    dry_run: dryRun,
  });

  const preview = () => {
    const nextErrors: Record<string, string> = {};
    if (!unitId) nextErrors.unit_id = "Choose the unit this obligation belongs to.";
    if (mode === "template" && !templateId) nextErrors.template_id = "Choose a template.";
    if (mode === "category" && !categoryId) nextErrors.category_id = "Choose a category.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    mutation.mutate(buildPayload(true));
  };

  const commit = () => mutation.mutate(buildPayload(false));

  const selectedTemplate = templates.find((row) => row.id === templateId);
  const selectedUnit = lookups.data?.units?.find((unit) => unit.id === unitId);
  const categoryOptions = flattenCategories(categoriesQuery.data ?? []).map((item) => ({
    value: item.id,
    label: categoryLabel(item),
  }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="xl"
      title="Instantiate into the register"
      description="Creates a live obligation with its first renewal cycle, for the unit you choose."
      footer={
        <>
          <Button onClick={onClose} className="sm:w-auto" block>
            Close
          </Button>
          <Button
            icon="search"
            onClick={preview}
            loading={mutation.isPending && mutation.variables?.dry_run === true}
            className="sm:w-auto"
            block
          >
            Preview
          </Button>
          <Button
            variant="primary"
            icon="check"
            onClick={() => setConfirmOpen(true)}
            disabled={!result || mutation.isPending}
            className="sm:w-auto"
            block
          >
            Create obligations
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface-muted p-3.5 text-sm text-ink-muted">
          <p className="font-medium text-ink">What this does</p>
          <p className="mt-1">
            The engine copies the template's validity, checklist, criticality and reminder profile
            onto a new obligation for the chosen unit, computes its renewal due date and expiry from
            the issue date, and opens the first cycle. Applying the same template twice is safe —
            duplicates are detected and skipped.
          </p>
        </div>

        <SegmentedControl
          label="What to instantiate"
          value={mode}
          onChange={(next) => setMode(next)}
          options={[
            { value: "template", label: "One template" },
            { value: "category", label: "A whole category" },
          ]}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "template" ? (
            <Field label="Template" required error={errors.template_id}>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={templateId}
                  placeholder="Choose a template…"
                  options={templates.map((row) => ({
                    value: row.id,
                    label: `${row.code} · ${row.name}`,
                  }))}
                  onChange={(event) => setTemplateId(event.target.value)}
                />
              )}
            </Field>
          ) : (
            <Field label="Category" required error={errors.category_id}>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={categoryId}
                  placeholder="Choose a category…"
                  options={categoryOptions}
                  onChange={(event) => setCategoryId(event.target.value)}
                />
              )}
            </Field>
          )}
          <Field label="Unit" required error={errors.unit_id}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={unitId}
                placeholder="Choose a unit…"
                options={toOptions(lookups.data?.units, { withCode: true })}
                onChange={(event) => setUnitId(event.target.value)}
              />
            )}
          </Field>
          <Field label="Owning department" hint="Falls back to the template's default">
            {({ id }) => (
              <Select
                id={id}
                value={departmentId}
                placeholder="Use the template default"
                options={toOptions(lookups.data?.departments)}
                onChange={(event) => setDepartmentId(event.target.value)}
              />
            )}
          </Field>
          <Field label="Owner" hint="Falls back to the department head">
            {({ id }) => (
              <Select
                id={id}
                value={ownerId}
                placeholder="Use the department head"
                options={toOptions(lookups.data?.users)}
                onChange={(event) => setOwnerId(event.target.value)}
              />
            )}
          </Field>
          <Field label="Issue date" hint="Defaults to today. The expiry is computed from it.">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            )}
          </Field>
        </div>

        {result && (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="text-sm font-semibold text-ink">
                {mutation.variables?.dry_run ? "Preview result" : "Created"}
              </p>
              <div className="flex gap-2">
                <Chip icon="check">
                  {mutation.variables?.dry_run ? "Would create" : "Created"} {result.created}
                </Chip>
                <Chip icon="minus">Skipped {result.skipped}</Chip>
              </div>
            </div>
            {result.details.length === 0 ? (
              <EmptyState
                icon="search"
                title="Nothing matched"
                description="No templates matched this selection, or every obligation already exists."
              />
            ) : (
              <ul className="divide-y divide-line">
                {result.details.map((detail, index) => (
                  <li key={`${detail.template}-${index}`} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{detail.template}</p>
                      <p className="text-2xs text-ink-subtle">
                        {detail.item_code ? `Register code ${detail.item_code}` : "No register code yet"}
                        {detail.expiry_date ? ` · expires ${formatDate(detail.expiry_date)}` : ""}
                      </p>
                    </div>
                    <Chip className="shrink-0">{detail.status}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={commit}
        tone="primary"
        title="Create these obligations?"
        confirmLabel="Create obligations"
        loading={mutation.isPending}
        message={
          <span>
            {mode === "template" && selectedTemplate ? (
              <>
                <strong>{selectedTemplate.name}</strong>
                {selectedUnit ? ` will be added to ${selectedUnit.name}` : ""} as a live obligation,
                with the first renewal cycle opened and reminders scheduled from the template's lead
                time.
              </>
            ) : (
              <>Every template in this category will be added to the unit as a live obligation.</>
            )}{" "}
            A reference number and expiry date are computed automatically. Existing obligations are
            skipped, never overwritten.
          </span>
        }
      />
    </Drawer>
  );
}
