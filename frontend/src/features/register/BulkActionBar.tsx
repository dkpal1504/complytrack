/**
 * The floating bulk-action bar.
 *
 * It appears only when rows are ticked, sits above the phone's bottom tab bar,
 * and every action states its consequence before it runs — reassigning eighty
 * statutory obligations is not something to do by reflex.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Feedback";
import { Field, Select, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { Icon } from "@/components/ui/Icon";
import { ApiError, api } from "@/lib/api";
import { invalidateRegister, queryClient } from "@/lib/query";
import { stringsToOptions, toOptions } from "@/features/org/useReference";
import { useLookups, useMeta } from "@/features/org/useReference";

interface BulkResult {
  detail: string;
  updated: number;
}

export interface BulkActionBarProps {
  selectedIds: string[];
  onClear: () => void;
  canReassign: boolean;
  canEdit: boolean;
}

export function BulkActionBar({ selectedIds, onClear, canReassign, canEdit }: BulkActionBarProps) {
  const [mode, setMode] = useState<"reassign" | "edit" | null>(null);
  const count = selectedIds.length;
  if (count === 0) return null;

  return (
    <>
      <div
        role="region"
        aria-label={`Bulk actions for ${count} selected obligations`}
        className="no-print fixed inset-x-3 bottom-20 z-40 mx-auto max-w-3xl rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-overlay)] md:bottom-6"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <span className="tabular inline-flex min-w-7 items-center justify-center rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
              {count}
            </span>
            selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canReassign && (
              <Button size="sm" icon="user-cog" onClick={() => setMode("reassign")}>
                Reassign owner
              </Button>
            )}
            {canEdit && (
              <Button size="sm" icon="edit" onClick={() => setMode("edit")}>
                Edit details
              </Button>
            )}
            <Button size="sm" variant="ghost" icon="x" onClick={onClear} aria-label="Clear selection">
              Clear
            </Button>
          </div>
        </div>
      </div>

      {mode === "reassign" && (
        <ReassignDialog itemIds={selectedIds} onClose={() => setMode(null)} onDone={onClear} />
      )}
      {mode === "edit" && (
        <BulkEditDialog itemIds={selectedIds} onClose={() => setMode(null)} onDone={onClear} />
      )}
    </>
  );
}

function ReassignDialog({
  itemIds,
  onClose,
  onDone,
}: {
  itemIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const lookups = useLookups();
  const [ownerId, setOwnerId] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api<BulkResult>("/items/bulk/reassign", {
        method: "POST",
        json: {
          item_ids: itemIds,
          owner_id: ownerId || null,
          delegate_id: delegateId || null,
          department_id: departmentId || null,
          reason: reason.trim(),
        },
      }),
    onSuccess: (result) => {
      toast.success("Owners reassigned", result.detail);
      invalidateRegister(queryClient);
      onDone();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.detail : "The reassignment failed."),
  });

  const nothingChosen = !ownerId && !delegateId && !departmentId;
  const canSubmit = !nothingChosen && reason.trim().length >= 3 && !mutation.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title="Reassign owner"
      description={`This will update ${itemIds.length} obligation${itemIds.length === 1 ? "" : "s"}.`}
      size="md"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            loading={mutation.isPending}
            block
            className="sm:w-auto"
          >
            Reassign {itemIds.length}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2 text-sm text-ink-muted">
          Leave a field blank to keep it as it is. Every change is written to the audit trail with
          your reason.
        </p>

        <Field label="New owner">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
              placeholder="Keep the current owner"
              options={toOptions(lookups.data?.users)}
            />
          )}
        </Field>
        <Field label="Delegate">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={delegateId}
              onChange={(event) => setDelegateId(event.target.value)}
              placeholder="Keep the current delegate"
              options={toOptions(lookups.data?.users)}
            />
          )}
        </Field>
        <Field label="Department">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              placeholder="Keep the current department"
              options={toOptions(lookups.data?.departments)}
            />
          )}
        </Field>
        <Field label="Reason" required hint="At least 3 characters">
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="e.g. Sandeep Rao is on leave; Priya Nair takes over."
            />
          )}
        </Field>

        {nothingChosen && (
          <p className="text-xs text-ink-muted">Choose at least one field to change.</p>
        )}

        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function BulkEditDialog({
  itemIds,
  onClose,
  onDone,
}: {
  itemIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const meta = useMeta();
  const lookups = useLookups();
  const [criticality, setCriticality] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [addTags, setAddTags] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      // The API accepts criticality, department, owner and tags. Category is
      // not one of them, so it is deliberately not offered here.
      const tags = addTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      return api<BulkResult>("/items/bulk/edit", {
        method: "POST",
        json: {
          item_ids: itemIds,
          set_criticality: criticality || null,
          set_department_id: departmentId || null,
          set_owner_id: ownerId || null,
          add_tags: tags.length ? tags : null,
          reason: reason.trim(),
        },
      });
    },
    onSuccess: (result) => {
      toast.success("Register updated", result.detail);
      invalidateRegister(queryClient);
      onDone();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.detail : "The bulk edit failed."),
  });

  const nothingChosen = !criticality && !departmentId && !ownerId && !addTags.trim();
  const canSubmit = !nothingChosen && reason.trim().length >= 3 && !mutation.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit details in bulk"
      description={`Apply the same change to ${itemIds.length} obligation${itemIds.length === 1 ? "" : "s"}.`}
      size="md"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            loading={mutation.isPending}
            block
            className="sm:w-auto"
          >
            Update {itemIds.length}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-amber-border bg-rag-amber-bg px-3 py-2 text-xs text-rag-amber">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          <span>
            Only the fields you set are changed. Dates, validity and applicability are not editable
            in bulk — open an obligation to change those.
          </span>
        </p>

        <Field label="Criticality">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={criticality}
              onChange={(event) => setCriticality(event.target.value)}
              placeholder="Keep each item's criticality"
              options={stringsToOptions(meta.data?.criticality)}
            />
          )}
        </Field>
        <Field label="Department">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              placeholder="Keep each item's department"
              options={toOptions(lookups.data?.departments)}
            />
          )}
        </Field>
        <Field label="Owner">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
              placeholder="Keep each item's owner"
              options={toOptions(lookups.data?.users)}
            />
          )}
        </Field>
        <Field label="Add tags" hint="Comma separated; existing tags are kept">
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              value={addTags}
              onChange={(event) => setAddTags(event.target.value)}
              placeholder="e.g. fy2026-27, inspection"
              className="h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none sm:h-10"
            />
          )}
        </Field>
        <Field label="Reason" required hint="At least 3 characters">
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="e.g. Criticality raised to Critical after the PCB inspection."
            />
          )}
        </Field>

        {nothingChosen && (
          <p className="text-xs text-ink-muted">Choose at least one field to change.</p>
        )}

        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
