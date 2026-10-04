/**
 * Reminder engine jobs (RM-08, AU-03).
 *
 * Every run of the daily reminder job, with its counters. Reading job history
 * needs the audit permission, so an administrator without it is told what is
 * missing rather than shown an empty table.
 *
 * "Run now" exists for the case where the scheduler window was missed. It runs
 * the same job the scheduler runs, so it is idempotent: obligations already
 * reminded today are suppressed as duplicates, not sent twice.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict, parseISO } from "date-fns";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, useToast } from "@/components/ui/Feedback";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { Panel, ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk, invalidateAdmin } from "@/lib/query";
import type { JobRunRow, RunNowResult } from "@/features/admin/admin-types";

/** The counters the daily job writes into `stats` (`services/reminders.py`). */
const STAT_KEYS: { key: string; label: string; tone?: "danger" | "warning" }[] = [
  { key: "reminders_sent", label: "Sent" },
  { key: "duplicates_suppressed", label: "Duplicates suppressed" },
  { key: "escalations", label: "Escalations" },
  { key: "instances_scanned", label: "Obligations scanned" },
  { key: "deferred", label: "Deferred (quiet hours)" },
  { key: "failures", label: "Failures", tone: "danger" },
  { key: "errors", label: "Errors", tone: "danger" },
];

const STATUS_STYLE: Record<string, { icon: IconName; className: string }> = {
  Success: {
    icon: "check-circle",
    className: "bg-rag-green-bg text-rag-green border-rag-green-border",
  },
  Completed: {
    icon: "check-circle",
    className: "bg-rag-green-bg text-rag-green border-rag-green-border",
  },
  Running: { icon: "progress", className: "bg-surface-muted text-ink-muted border-line" },
  Failed: { icon: "alert-circle", className: "bg-rag-red-bg text-rag-red border-rag-red-border" },
};

export function JobsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [confirmRun, setConfirmRun] = useState(false);
  const [lastRun, setLastRun] = useState<RunNowResult | null>(null);

  const query = useQuery({
    queryKey: qk.reminders.jobs,
    queryFn: () => api<JobRunRow[]>("/reminders/jobs"),
  });

  const run = useMutation({
    mutationFn: () => api<RunNowResult>("/reminders/run", { method: "POST" }),
    onSuccess: (result) => {
      setLastRun(result);
      toast.success(
        `Daily job finished — ${result.reminders_sent} reminder(s) sent`,
        `${result.escalations} escalation(s), ${result.skipped_duplicates} duplicate(s) suppressed.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
      invalidateAdmin(queryClient);
      setConfirmRun(false);
    },
    onError: (error) => {
      toast.error(
        "The daily job did not finish",
        error instanceof ApiError ? error.detail : undefined,
      );
      setConfirmRun(false);
    },
  });

  const rows = query.data ?? [];

  const columns: Column<JobRunRow>[] = [
    {
      key: "job",
      header: "Job",
      isTitle: true,
      sortValue: (row) => row.job_name,
      cell: (row) => <span className="font-medium text-ink">{row.job_name}</span>,
    },
    {
      key: "started",
      header: "Started",
      sortValue: (row) => row.started_at,
      cell: (row) => <span className="tabular">{formatDateTime(row.started_at)}</span>,
    },
    {
      key: "duration",
      header: "Ran for",
      hideBelow: "md",
      cell: (row) =>
        row.finished_at ? (
          <span className="tabular">
            {formatDistanceToNowStrict(parseISO(row.finished_at), {
              addSuffix: false,
              roundingMethod: "ceil",
            })}
          </span>
        ) : (
          <span className="text-ink-muted">Still running</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      cell: (row) => {
        const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.Running;
        return (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium ${style.className}`}
          >
            <Icon name={style.icon} size={12} />
            {row.status}
          </span>
        );
      },
    },
    {
      key: "stats",
      header: "Counters",
      hideBelow: "lg",
      cell: (row) => {
        const entries = STAT_KEYS.filter((stat) => typeof row.stats?.[stat.key] === "number");
        if (entries.length === 0) return <span className="text-ink-subtle">—</span>;
        return (
          <div className="flex flex-wrap gap-1.5">
            {entries.map((stat) => (
              <span
                key={stat.key}
                className={
                  stat.tone === "danger" && (row.stats[stat.key] ?? 0) > 0
                    ? "text-2xs font-medium text-rag-red"
                    : "text-2xs text-ink-muted"
                }
                title={stat.label}
              >
                {stat.label}: <span className="tabular font-semibold">{row.stats[stat.key]}</span>
              </span>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Engine jobs</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              The daily reminder job scans every open obligation, sends what is due today and
              escalates what has been missed. Running it twice in one day sends nothing twice.
            </p>
          </div>
          <Button
            variant="primary"
            icon="refresh"
            size="sm"
            onClick={() => setConfirmRun(true)}
            loading={run.isPending}
          >
            Run now
          </Button>
        </div>

        {lastRun && (
          <div
            role="status"
            className="border-b border-line bg-rag-green-bg px-4 py-3 sm:px-5"
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-rag-green">
              <Icon name="check-circle" size={14} />
              Last manual run — {formatDateTime(lastRun.ran_at)}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-4">
              <Counter label="Reminders sent" value={lastRun.reminders_sent} />
              <Counter label="Escalations" value={lastRun.escalations} />
              <Counter label="Duplicates suppressed" value={lastRun.skipped_duplicates} />
              <Counter label="Failures" value={lastRun.failures} tone="danger" />
              <Counter label="Deferred" value={lastRun.deferred} />
              <Counter label="Obligations scanned" value={lastRun.instances_scanned} />
            </dl>
            {lastRun.errors.length > 0 && (
              <ul role="alert" className="mt-2 space-y-0.5">
                {lastRun.errors.map((message, index) => (
                  <li key={index} className="text-2xs text-rag-red">
                    {message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Toolbar label="Job history">
          <ResultCount shown={rows.length} total={rows.length} noun="job run" />
        </Toolbar>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption="Reminder engine job history"
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            loading={query.isPending}
            empty={
              <EmptyState
                icon="history"
                title="No job runs recorded"
                description="The engine has not run yet. Its history appears here after the first scheduled or manual run."
              />
            }
          />
        )}
      </Card>

      <Panel title="What the job does" icon="info">
        <ul className="space-y-1.5 text-xs text-ink-muted">
          <li className="flex gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0 text-rag-green" />
            Scans every open obligation with an expiry or renewal date and works out which reminder
            offsets fall on today.
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0 text-rag-green" />
            Sends through the channels the obligation's profile configures, respecting quiet hours
            unless the profile is exempt.
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0 text-rag-green" />
            Raises escalations from the ladder and widens the audience as the deadline approaches or
            passes.
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0 text-rag-green" />
            Records every attempt in the delivery log, including failures, so a missed warning can
            be traced.
          </li>
        </ul>
      </Panel>

      <ConfirmDialog
        open={confirmRun}
        onClose={() => setConfirmRun(false)}
        onConfirm={() => run.mutate()}
        loading={run.isPending}
        tone="primary"
        title="Run the daily reminder job now?"
        confirmLabel="Run the job"
        message={
          <>
            <p>
              This runs the same job the scheduler runs at its daily window. It is safe to run more
              than once: obligations already reminded today are skipped as duplicates.
            </p>
            <p className="mt-2">
              Reminders and escalations go out immediately — recipients are emailed as soon as the
              run finishes.
            </p>
          </>
        }
      />
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div>
      <dt className="text-ink-subtle">{label}</dt>
      <dd
        className={
          tone === "danger" && value > 0
            ? "tabular font-semibold text-rag-red"
            : "tabular font-semibold text-ink"
        }
      >
        {value}
      </dd>
    </div>
  );
}
