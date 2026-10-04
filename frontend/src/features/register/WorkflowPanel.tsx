/**
 * The renewal cycle: where it stands, what it can become, and what the move
 * needs first (PRD §8, RT-01 … RT-08).
 *
 * The state machine is not hard-coded here. `GET /items/status-options` returns
 * every legal transition from every status together with the fields each one
 * demands, and the panel renders exactly what that says — so the screen cannot
 * drift out of step with the server's rules.
 *
 * One thing the API does not do, and the panel says so out loud: the fields a
 * transition requires are collected before the request is sent, and if the
 * server still refuses, its message (including which fields were missing) is
 * shown verbatim rather than swallowed.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, StatusChip } from "@/components/ui/Chip";
import { ErrorState, Meter, SkeletonRows, useToast } from "@/components/ui/Feedback";
import { DescriptionItem, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { Icon } from "@/components/ui/Icon";
import { ApiError, api } from "@/lib/api";
import { invalidateRegister, qk, queryClient } from "@/lib/query";
import { formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PERM, useAuth } from "@/features/auth/auth-context";
import type {
  CycleSummary,
  ItemDetail,
  StatusOptions,
  TransitionOption,
  WorkflowInstanceResponse,
} from "@/features/register/api-types";
import type { ItemStatus } from "@/types/api";

const PATH: ItemStatus[] = ["Pending", "Under Process", "Submitted", "Renewed", "Closed"];

const OFF_PATH: ItemStatus[] = ["Query Raised", "On Hold", "Not Applicable"];

/** Which input a required payload field needs. */
const FIELD_KIND: Record<string, "date" | "number" | "textarea" | "text"> = {
  expected_filing_date: "date",
  submission_date: "date",
  new_issue_date: "date",
  new_expiry_date: "date",
  review_date: "date",
  acknowledgement_no: "text",
  new_reference_number: "text",
  reference_number: "text",
  fee_paid: "number",
  delay_days: "number",
  on_hold_reason: "textarea",
  verification_remark: "textarea",
  reason: "textarea",
  remarks: "textarea",
};

/** Document requirements the payload cannot satisfy — the file must be uploaded. */
const DOCUMENT_REQUIREMENTS = new Set([
  "evidence",
  "renewed_certificate",
  "supporting document (acknowledgement / challan / receipt)",
  "renewed certificate upload",
]);

export interface WorkflowPanelProps {
  item: ItemDetail;
  instance: CycleSummary;
  onChanged: () => void;
}

export function WorkflowPanel({ item, instance, onChanged }: WorkflowPanelProps) {
  const { can, user, hasRole } = useAuth();
  const [target, setTarget] = useState<TransitionOption | null>(null);
  const [mode, setMode] = useState<"transition" | "verify" | "roll-forward" | null>(null);

  // The full cycle record — checklist, verification remark and the timestamps
  // the list summary does not carry.
  const detail = useQuery({
    queryKey: qk.instances.detail(instance.id),
    queryFn: () => api<WorkflowInstanceResponse>(`/instances/${instance.id}`),
    retry: false,
  });

  const options = useQuery({
    queryKey: qk.items.statusOptions,
    queryFn: () => api<StatusOptions>("/items/status-options"),
    staleTime: 30 * 60_000,
  });

  const current = detail.data?.status ?? instance.status;
  const progress = detail.data?.progress ?? instance.progress;

  const isOwner =
    Boolean(user) && (item.owner_id === user?.id || item.delegate_id === user?.id);

  const transitions = (options.data?.transitions[current] ?? []).filter((option) => {
    if (option.roles.includes("owner") && isOwner) return true;
    return user ? option.roles.includes(user.role) : false;
  });

  const canVerify = can(PERM.VERIFY_CLOSE);
  const canRollForward = can(PERM.MANAGE_ITEMS);

  return (
    <div className="space-y-5">
      {detail.isError && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-amber-border bg-rag-amber-bg px-3 py-2.5 text-xs text-rag-amber"
        >
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          <span>
            The cycle-detail endpoint (<code>/instances/{instance.id}</code>) returned an error, so
            the checklist and verification remark cannot be shown here. The cycle's status, dates
            and progress below come from the obligation record. Moving the cycle forward still
            works.
          </span>
        </p>
      )}

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={current} />
            <span className="text-sm font-medium text-ink">{instance.cycle_label}</span>
            {instance.renewal_in_process && <Chip icon="progress">Renewal in progress</Chip>}
            {instance.escalation_level > 0 && (
              <Chip className="border-rag-red-border bg-rag-red-bg text-rag-red" icon="bell">
                Escalation level {instance.escalation_level}
              </Chip>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xs text-ink-subtle">Document checklist</span>
              <Meter
              done={progress.received}
              total={progress.total}
              waived={progress.total - progress.received - progress.pending}
            />
          </div>
        </div>

        <Stepper status={current} />

        {OFF_PATH.includes(current) && (
          <p className="mt-3 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2 text-xs text-ink-muted">
            {current === "On Hold"
              ? `On hold${detail.data?.on_hold_reason ? `: ${detail.data.on_hold_reason}` : ""}. Review before the resume date.`
              : current === "Query Raised"
                ? "The authority has raised a query. Respond to return the cycle to Under Process."
                : "This cycle is marked Not Applicable and takes no further part in the renewal path."}
          </p>
        )}

        <dl className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <DescriptionItem label="Cycle due date">
            <span className="tabular">{formatDate(instance.due_date)}</span>
          </DescriptionItem>
          <DescriptionItem label="Renewal period">
            {instance.period_start || instance.period_end
              ? `${formatDate(instance.period_start)} – ${formatDate(instance.period_end)}`
              : "—"}
          </DescriptionItem>
          <DescriptionItem label="Delay">
            {instance.delay_days > 0 ? (
              <span className="text-rag-red">{instance.delay_days} days</span>
            ) : (
              "On time"
            )}
          </DescriptionItem>
          <DescriptionItem label="Expected filing date">
            <span className="tabular">
              {formatDate(detail.data?.expected_filing_date ?? null)}
            </span>
          </DescriptionItem>
          <DescriptionItem label="Submitted on">
            {detail.isPending ? (
              <span className="text-ink-subtle">Loading…</span>
            ) : detail.isError ? (
              <span className="text-ink-subtle">Not available</span>
            ) : (
              formatDateTime(detail.data?.submission_date ?? null)
            )}
          </DescriptionItem>
          <DescriptionItem label="Acknowledgement no.">
            {instance.acknowledgement_no ?? detail.data?.acknowledgement_no ?? "—"}
          </DescriptionItem>
          <DescriptionItem label="Verification">
            {detail.data?.verification_remark ? (
              <>
                <span className="font-medium">{titleCase(detail.data.verification_status)}</span>
                <span className="block text-xs text-ink-muted">{detail.data.verification_remark}</span>
                {detail.data.verified_at && (
                  <span className="block text-2xs text-ink-subtle">
                    {formatDateTime(detail.data.verified_at)}
                  </span>
                )}
              </>
            ) : (
              titleCase(instance.verification_status)
            )}
          </DescriptionItem>
          <DescriptionItem label="New reference number">
            {instance.new_reference_number ?? "—"}
          </DescriptionItem>
          <DescriptionItem label="New issue / expiry">
            {instance.new_issue_date || instance.new_expiry_date
              ? `${formatDate(instance.new_issue_date)} → ${formatDate(instance.new_expiry_date)}`
              : "—"}
          </DescriptionItem>
          <DescriptionItem label="Fee paid">
            {formatMoney(instance.fee_paid ?? detail.data?.fee_paid ?? null)}
          </DescriptionItem>
          <DescriptionItem label="Closed at">
            {formatDateTime(instance.closed_at)}
          </DescriptionItem>
        </dl>
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-ink">Next step</h3>

        {options.isPending ? (
          <div className="mt-3">
            <SkeletonRows rows={2} />
          </div>
        ) : options.isError ? (
          <ErrorState
            error={options.error}
            onRetry={() => void options.refetch()}
            className="mt-3"
          />
        ) : (
          <>
            {transitions.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">
                {current === "Closed"
                  ? "This cycle is closed. Use Roll forward to open the next one."
                  : "No transition is available to you from this status. A member of the Compliance Team can move it on."}
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {transitions.map((option) => (
                  <Button
                    key={option.target}
                    variant={option.target === "Closed" ? "primary" : "secondary"}
                    icon={option.target === "Closed" ? "check" : "arrow-right"}
                    onClick={() => {
                      setTarget(option);
                      setMode("transition");
                    }}
                  >
                    {option.label || titleCase(option.target)}
                  </Button>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              {canVerify ? (
                <Button variant="success" icon="shield-check" onClick={() => setMode("verify")}>
                  Verify &amp; close
                </Button>
              ) : (
                <p className="text-xs text-ink-muted">
                  Verifying and closing a renewal needs the Compliance Team's permission — you can
                  see the cycle but not sign it off.
                </p>
              )}
              {canRollForward && (
                <Button icon="restore" onClick={() => setMode("roll-forward")}>
                  Roll forward
                </Button>
              )}
            </div>
          </>
        )}

        {hasRole("Auditor") && (
          <p className="mt-3 text-2xs text-ink-subtle">
            Auditors have read-only access to the register; no workflow actions are offered.
          </p>
        )}
      </Card>

      {target && mode === "transition" && (
        <TransitionDialog
          instanceId={instance.id}
          itemLabel={`${item.item_code} · ${item.name}`}
          option={target}
          onClose={() => {
            setMode(null);
            setTarget(null);
          }}
          onDone={onChanged}
        />
      )}

      {mode === "verify" && (
        <VerifyDialog
          instanceId={instance.id}
          itemLabel={`${item.item_code} · ${item.name}`}
          currentExpiry={item.expiry_date}
          onClose={() => setMode(null)}
          onDone={onChanged}
        />
      )}

      {mode === "roll-forward" && (
        <Modal
          open
          onClose={() => setMode(null)}
          title="Roll forward to the next cycle?"
          description="Opens the following renewal period for this obligation."
          size="sm"
          footer={
            <>
              <Button onClick={() => setMode(null)} block className="sm:w-auto">
                Cancel
              </Button>
              <RollForwardButton instanceId={instance.id} onDone={onChanged} onClose={() => setMode(null)} />
            </>
          }
        >
          <p className="text-sm text-ink-muted">
            The next cycle is opened from the item's recurrence rule. The current cycle is left
            exactly as it is.
          </p>
        </Modal>
      )}
    </div>
  );
}

/* --------------------------------- stepper --------------------------------- */

function Stepper({ status }: { status: ItemStatus }) {
  const currentIndex = PATH.indexOf(status);
  const offPath = OFF_PATH.includes(status);

  return (
    <ol className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-label="Renewal progress">
      {PATH.map((step, index) => {
        const done = !offPath && currentIndex > index;
        const active = !offPath && currentIndex === index;
        return (
          <li key={step} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium",
                active
                  ? "border-brand-300 bg-brand-600 text-white"
                  : done
                    ? "border-rag-green-border bg-rag-green-bg text-rag-green"
                    : "border-line bg-surface-muted text-ink-muted",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? (
                <Icon name="check" size={11} />
              ) : (
                <span className="tabular">{index + 1}</span>
              )}
              {step}
            </span>
            {index < PATH.length - 1 && (
              <Icon name="chevron-right" size={13} className="text-ink-subtle" />
            )}
          </li>
        );
      })}
      {offPath && (
        <li className="ml-1">
          <StatusChip status={status} />
        </li>
      )}
    </ol>
  );
}

/* ------------------------------ transitions ------------------------------ */

function TransitionDialog({
  instanceId,
  itemLabel,
  option,
  onClose,
  onDone,
}: {
  instanceId: string;
  itemLabel: string;
  option: TransitionOption;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const payloadFields = option.requires.filter((field) => !DOCUMENT_REQUIREMENTS.has(field));
  const documentFields = option.requires.filter((field) => DOCUMENT_REQUIREMENTS.has(field));

  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const json: Record<string, unknown> = { target_status: option.target };
      if (option.requires_reason || reason.trim()) json.reason = reason.trim() || null;
      for (const field of payloadFields) {
        const raw = values[field];
        if (raw === undefined || raw === "") continue;
        json[field] = FIELD_KIND[field] === "number" ? Number(raw) : raw;
      }
      return api<{ detail: string }>(`/instances/${instanceId}/transition`, {
        method: "POST",
        json,
      });
    },
    onSuccess: (data) => {
      toast.success("Cycle moved", data.detail);
      invalidateRegister(queryClient);
      onDone();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.detail : "The cycle could not be moved."),
  });

  const missing = payloadFields.filter((field) => !values[field]);
  const needsReason = option.requires_reason && reason.trim().length < 3;
  const canSubmit =
    missing.length === 0 && !needsReason && documentFields.length === 0 && !mutation.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title={option.label || `Move to ${option.target}`}
      description={itemLabel}
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
            Move to {option.target}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {documentFields.length > 0 && (
          <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-amber-border bg-rag-amber-bg px-3 py-2 text-xs text-rag-amber">
            <Icon name="document" size={15} className="mt-0.5 shrink-0" />
            <span>
              This move needs {documentFields.map((field) => titleCase(field)).join(", ")} on file
              first. Upload it from the Documents tab, then come back — the workflow will not accept
              the move without it.
            </span>
          </p>
        )}

        {payloadFields.map((field) => (
          <Field key={field} label={titleCase(field)} required>
            {({ id, describedBy, invalid }) => {
              const kind = FIELD_KIND[field] ?? "text";
              const value = values[field] ?? "";
              const onChange = (next: string) =>
                setValues((current) => ({ ...current, [field]: next }));
              if (kind === "textarea") {
                return (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    rows={2}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                  />
                );
              }
              return (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
                  inputMode={kind === "number" ? "decimal" : undefined}
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                />
              );
            }}
          </Field>
        ))}

        {(option.requires_reason || !payloadFields.length) && (
          <Field
            label="Reason"
            required={option.requires_reason}
            hint="Recorded on the audit trail"
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        )}

        {error && (
          <p role="alert" className="whitespace-pre-line rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------ verification ------------------------------ */

function VerifyDialog({
  instanceId,
  itemLabel,
  currentExpiry,
  onClose,
  onDone,
}: {
  instanceId: string;
  itemLabel: string;
  currentExpiry: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [remark, setRemark] = useState("");
  const [expiry, setExpiry] = useState("");
  const [reference, setReference] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [rollForward, setRollForward] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api<{ detail: string }>(`/instances/${instanceId}/verify`, {
        method: "POST",
        json: {
          decision,
          remark: remark.trim(),
          new_expiry_date: expiry || null,
          new_reference_number: reference.trim() || null,
          new_issue_date: issueDate || null,
          roll_forward: rollForward,
        },
      }),
    onSuccess: (data) => {
      toast.success(data.detail, rollForward ? "The next cycle has been opened." : undefined);
      invalidateRegister(queryClient);
      onDone();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.detail : "The decision could not be recorded."),
  });

  const canSubmit = remark.trim().length >= 3 && !mutation.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title="Verify this renewal"
      description={itemLabel}
      size="md"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant={decision === "approve" ? "success" : "danger"}
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            loading={mutation.isPending}
            block
            className="sm:w-auto"
          >
            {decision === "approve" ? "Approve renewal" : "Send back"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Decision">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={decision}
              onChange={(event) => setDecision(event.target.value as "approve" | "reject")}
              options={[
                { value: "approve", label: "Approve — the renewal is complete" },
                { value: "reject", label: "Send back — the evidence is not sufficient" },
              ]}
            />
          )}
        </Field>

        <Field label="Verification remark" required hint="At least 3 characters">
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              rows={3}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              placeholder="e.g. Renewed certificate and fee challan checked against the authority's portal."
            />
          )}
        </Field>

        {decision === "approve" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New expiry date" hint={currentExpiry ? `Currently ${formatDate(currentExpiry)}` : undefined}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="date"
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                )}
              </Field>
              <Field label="New issue date">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="date"
                    value={issueDate}
                    onChange={(event) => setIssueDate(event.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="New reference number" hint="Copied onto the obligation when the renewal is approved">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              )}
            </Field>
            <label className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5">
              <input
                type="checkbox"
                checked={rollForward}
                onChange={(event) => setRollForward(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-600)]"
              />
              <span className="text-sm text-ink">
                Roll forward to the next cycle
                <span className="block text-2xs text-ink-subtle">
                  Opens the following renewal period straight away.
                </span>
              </span>
            </label>
          </>
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

function RollForwardButton({
  instanceId,
  onDone,
  onClose,
}: {
  instanceId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      api<{ detail: string; created: boolean }>(`/instances/${instanceId}/roll-forward`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      toast.success(data.created ? "Next cycle opened" : "No further cycle", data.detail);
      invalidateRegister(queryClient);
      onDone();
      onClose();
    },
    onError: (error) =>
      toast.error("Could not roll forward", error instanceof ApiError ? error.detail : undefined),
  });

  return (
    <Button
      variant="primary"
      icon="arrow-right"
      onClick={() => mutation.mutate()}
      loading={mutation.isPending}
      block
      className="sm:w-auto"
    >
      Roll forward
    </Button>
  );
}
