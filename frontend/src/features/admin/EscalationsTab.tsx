/**
 * Escalation history and acknowledgement (EX-08).
 *
 * An escalation that nobody acknowledges is the failure mode this screen
 * exists to catch: management has been told, and nobody has said what happened.
 * The outcome note is mandatory — "acknowledged" on its own is not an answer
 * anyone can audit.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, useToast } from "@/components/ui/Feedback";
import { Field, Select, Textarea } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Overlay";
import { ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk, invalidateAdmin } from "@/lib/query";
import { roleLabel } from "@/features/admin/admin-utils";
import type { EscalationLogRow } from "@/features/admin/admin-types";

const LEVELS = [
  { value: "0", label: "Level 0 — reminder to owner" },
  { value: "1", label: "Level 1 — department head" },
  { value: "2", label: "Level 2 — unit head and compliance" },
  { value: "3", label: "Level 3 — plant head and management" },
  { value: "4", label: "Level 4 — director" },
];

export function EscalationsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [level, setLevel] = useState("");
  const [acknowledging, setAcknowledging] = useState<EscalationLogRow | null>(null);
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: qk.reminders.escalationLog({ level }),
    queryFn: () =>
      api<EscalationLogRow[]>("/reminders/escalation-log", {
        query: { level: level || undefined, limit: 200 },
      }),
  });

  const acknowledge = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api<{ detail: string }>(`/reminders/escalations/${id}/acknowledge`, {
        method: "POST",
        query: { outcome: note },
      }),
    onSuccess: () => {
      toast.success("Escalation acknowledged", "The outcome has been recorded.");
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
      invalidateAdmin(queryClient);
      setAcknowledging(null);
      setOutcome("");
    },
    onError: (err) => {
      toast.error(
        "Could not acknowledge the escalation",
        err instanceof ApiError ? err.detail : undefined,
      );
    },
  });

  const rows = query.data ?? [];
  const pending = rows.filter((row) => !row.acknowledged_at).length;

  const submit = () => {
    if (!acknowledging) return;
    const note = outcome.trim();
    if (note.length < 3) {
      setError("Describe the outcome in at least three characters — the server requires it.");
      return;
    }
    setError(null);
    acknowledge.mutate({ id: acknowledging.id, note });
  };

  const columns: Column<EscalationLogRow>[] = [
    {
      key: "level",
      header: "Level",
      isTitle: true,
      sortValue: (row) => row.level,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="tabular inline-flex size-6 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-ink">
            {row.level}
          </span>
          <span className="font-medium text-ink">{row.label}</span>
        </div>
      ),
    },
    {
      key: "item",
      header: "Obligation",
      cell: (row) => (
        <a
          href={`/items/${row.instance_id}`}
          className="text-brand-700 hover:underline"
          title="Open the obligation this escalation belongs to"
        >
          Open obligation
        </a>
      ),
    },
    {
      key: "notified",
      header: "Notified",
      hideBelow: "md",
      cell: (row) =>
        row.notified_to.length === 0 ? (
          <span className="text-ink-subtle">Nobody recorded</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.notified_to.map((role, index) => (
              <Chip key={`${role}-${index}`} icon="bell">
                {roleLabel(role)}
              </Chip>
            ))}
          </div>
        ),
    },
    {
      key: "triggered",
      header: "Raised",
      sortValue: (row) => row.triggered_at,
      cell: (row) => <span className="tabular">{formatDateTime(row.triggered_at)}</span>,
    },
    {
      key: "state",
      header: "State",
      sortValue: (row) => (row.acknowledged_at ? 1 : 0),
      cell: (row) =>
        row.acknowledged_at ? (
          <Chip icon="check">Acknowledged</Chip>
        ) : (
          <Chip icon="alert" className="border-rag-amber-border bg-rag-amber-bg text-rag-amber">
            Awaiting a response
          </Chip>
        ),
    },
    {
      key: "acknowledged",
      header: "Acknowledged",
      hideBelow: "xl",
      mobileLabel: "Acknowledged",
      sortValue: (row) => row.acknowledged_at,
      cell: (row) =>
        row.acknowledged_at ? (
          <span className="tabular">{formatDateTime(row.acknowledged_at)}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "outcome",
      header: "Outcome",
      hideBelow: "lg",
      cell: (row) =>
        row.outcome ? (
          <span className="block max-w-[26rem] text-xs text-ink-muted">{row.outcome}</span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      mobileLabel: "Actions",
      cell: (row) =>
        row.acknowledged_at ? null : (
          <Button
            size="sm"
            variant="primary"
            icon="check"
            onClick={() => {
              setAcknowledging(row);
              setOutcome("");
              setError(null);
            }}
            aria-label={`Acknowledge the level ${row.level} escalation`}
          >
            Acknowledge
          </Button>
        ),
    },
  ];

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Escalations</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              Every time the ladder fired, who was told, and what was done about it. An escalation
              without an outcome is still open business.
            </p>
          </div>
          {pending > 0 && (
            <Chip icon="alert" className="border-rag-amber-border bg-rag-amber-bg text-rag-amber">
              {pending} awaiting a response
            </Chip>
          )}
        </div>

        <Toolbar label="Escalation filters">
          <Select
            aria-label="Escalation level"
            value={level}
            placeholder="Any level"
            className="sm:w-72"
            options={LEVELS}
            onChange={(event) => setLevel(event.target.value)}
          />
          <ResultCount shown={rows.length} total={rows.length} noun="escalation" className="sm:ml-auto" />
        </Toolbar>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption="Escalation history"
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            loading={query.isPending}
            rowTone={(row) => (row.acknowledged_at ? undefined : "warning")}
            empty={
              <EmptyState
                icon="bell-ring"
                title="No escalations recorded"
                description={
                  level
                    ? "No obligation has escalated to that level yet."
                    : "Nothing has escalated. When a deadline is missed, the ladder's first levels appear here."
                }
              />
            }
          />
        )}
      </Card>

      <Modal
        open={acknowledging !== null}
        onClose={() => setAcknowledging(null)}
        title="Acknowledge this escalation"
        description={
          acknowledging
            ? `Level ${acknowledging.level} — ${acknowledging.label}, raised ${formatDateTime(acknowledging.triggered_at)}.`
            : undefined
        }
        footer={
          <>
            <Button onClick={() => setAcknowledging(null)} className="sm:w-auto" block>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="check"
              onClick={submit}
              loading={acknowledge.isPending}
              className="sm:w-auto"
              block
            >
              Record the outcome
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field
            label="What was done?"
            required
            error={error}
            hint="Recorded against your name in the audit trail"
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                rows={4}
                aria-describedby={describedBy}
                invalid={invalid}
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                placeholder="e.g. Renewal fee paid on 02 Oct; certificate awaited from the authority."
              />
            )}
          </Field>
          <p className="flex items-start gap-1.5 text-2xs text-ink-subtle">
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            This note is what an auditor reads later, so record the action, not just that you saw it.
          </p>
        </div>
      </Modal>
    </>
  );
}
