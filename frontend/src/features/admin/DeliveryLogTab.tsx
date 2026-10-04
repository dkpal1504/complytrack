/**
 * The delivery log (RM-08, RM-09).
 *
 * Every reminder the engine has attempted, with its channel, recipient and
 * outcome. This is the screen an administrator opens when somebody says they
 * never received a warning, so the status is spelled out in words and the
 * failure reason is shown verbatim.
 *
 * The API paginates by limit/offset and filters by status and channel only.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState, useToast } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Form";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, Pagination, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk, invalidateAdmin } from "@/lib/query";
import { CHANNELS, offsetLabel } from "@/features/admin/admin-utils";
import type { DeliveryLogResponse, DeliveryLogRow } from "@/features/admin/admin-types";

/** Reminder statuses (`domain/enums.py` ReminderStatus) — not the item statuses. */
const STATUSES = ["Queued", "Sent", "Delivered", "Failed", "Read", "Skipped"];

const STATUS_STYLE: Record<string, { icon: IconName; className: string }> = {
  Queued: { icon: "clock", className: "bg-surface-muted text-ink-muted border-line" },
  Sent: { icon: "check", className: "bg-rag-green-bg text-rag-green border-rag-green-border" },
  Delivered: { icon: "mail-check", className: "bg-rag-green-bg text-rag-green border-rag-green-border" },
  Read: { icon: "check-circle", className: "bg-rag-green-bg text-rag-green border-rag-green-border" },
  Failed: { icon: "alert-circle", className: "bg-rag-red-bg text-rag-red border-rag-red-border" },
  Skipped: { icon: "pause", className: "bg-rag-amber-bg text-rag-amber border-rag-amber-border" },
};

const PAGE_SIZE = 50;

export function DeliveryLogTab() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [page, setPage] = useState(1);
  const [confirmRetry, setConfirmRetry] = useState(false);

  const query = useQuery({
    queryKey: qk.reminders.log({ status, channel, page }),
    queryFn: () =>
      api<DeliveryLogResponse>("/reminders/log", {
        query: {
          status: status || undefined,
          channel: channel || undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        },
      }),
  });

  const retry = useMutation({
    mutationFn: () => api<{ detail: string; sent: number }>("/reminders/retry-failed", { method: "POST" }),
    onSuccess: (result) => {
      toast.success(
        result.sent > 0 ? `${result.sent} reminder(s) re-sent` : "Nothing to re-send",
        result.detail,
      );
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
      invalidateAdmin(queryClient);
      setConfirmRetry(false);
    },
    onError: (error) => {
      toast.error(
        "Could not re-send the failures",
        error instanceof ApiError ? error.detail : undefined,
      );
      setConfirmRetry(false);
    },
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const columns: Column<DeliveryLogRow>[] = [
    {
      key: "scheduled",
      header: "Scheduled",
      isTitle: true,
      sortValue: (row) => row.scheduled_at,
      cell: (row) => <span className="tabular">{formatDateTime(row.scheduled_at)}</span>,
    },
    {
      key: "item",
      header: "Obligation",
      sortValue: (row) => row.item_id,
      cell: (row) => (
        <a href={`/items/${row.item_id}`} className="text-brand-700 hover:underline">
          Open obligation
        </a>
      ),
    },
    {
      key: "offset",
      header: "Offset",
      hideBelow: "md",
      sortValue: (row) => row.offset,
      cell: (row) => (
        <span>
          {offsetLabel(row.offset)}
          {row.is_post_expiry && (
            <span className="ml-1 text-2xs text-rag-red">overdue</span>
          )}
        </span>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      hideBelow: "lg",
      sortValue: (row) => row.channel,
      cell: (row) => CHANNELS.find((entry) => entry.key === row.channel)?.label ?? row.channel,
    },
    {
      key: "recipient",
      header: "Recipient",
      hideBelow: "lg",
      mobileLabel: "Recipient",
      sortValue: (row) => row.recipient,
      cell: (row) => <span className="truncate">{row.recipient ?? "—"}</span>,
    },
    {
      key: "subject",
      header: "Subject",
      hideBelow: "xl",
      cell: (row) => <span className="block max-w-[22rem] truncate">{row.subject ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      cell: (row) => {
        const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.Queued;
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
      key: "sent",
      header: "Sent",
      hideBelow: "xl",
      mobileLabel: "Sent",
      sortValue: (row) => row.sent_at,
      cell: (row) => (row.sent_at ? <span className="tabular">{formatDateTime(row.sent_at)}</span> : "—"),
    },
    {
      key: "retries",
      header: "Retries",
      align: "right",
      hideBelow: "md",
      sortValue: (row) => row.retry_count,
      cell: (row) => <span className="tabular">{row.retry_count}</span>,
    },
    {
      key: "error",
      header: "Failure reason",
      hideBelow: "xl",
      mobileLabel: "Failure",
      cell: (row) =>
        row.error ? (
          <span className="block max-w-[24rem] text-xs text-rag-red">{row.error}</span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
  ];

  const failedOnPage = rows.filter((row) => row.status === "Failed").length;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Delivery log</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              What the engine sent, to whom, and what happened. Re-running the daily job never
              duplicates an entry — suppressed duplicates are recorded, not lost.
            </p>
          </div>
          <Button
            variant="secondary"
            icon="refresh"
            size="sm"
            onClick={() => setConfirmRetry(true)}
            disabled={total === 0}
          >
            Re-send failed
          </Button>
        </div>

        <Toolbar label="Delivery log filters">
          <Select
            aria-label="Status"
            value={status}
            placeholder="Any status"
            options={STATUSES.map((value) => ({ value, label: value }))}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          />
          <Select
            aria-label="Channel"
            value={channel}
            placeholder="Any channel"
            options={CHANNELS.map((entry) => ({ value: entry.key, label: entry.label }))}
            onChange={(event) => {
              setChannel(event.target.value);
              setPage(1);
            }}
          />
          <ResultCount shown={rows.length} total={total} noun="delivery" className="sm:ml-auto" />
        </Toolbar>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <DataTable
              caption="Reminder delivery log"
              columns={columns}
              rows={rows}
              getRowId={(row) => row.id}
              loading={query.isPending}
              rowTone={(row) => (row.status === "Failed" ? "danger" : undefined)}
              empty={
                <p className="px-5 py-8 text-center text-sm text-ink-muted">
                  {status || channel
                    ? "No delivery matches these filters."
                    : "Nothing has been sent yet. Run the daily job from the Jobs tab to see entries here."}
                </p>
              }
            />
            <Pagination
              page={page}
              pages={pages}
              total={total}
              pageSize={PAGE_SIZE}
              onPage={setPage}
            />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirmRetry}
        onClose={() => setConfirmRetry(false)}
        onConfirm={() => retry.mutate()}
        loading={retry.isPending}
        tone="primary"
        title="Re-send the failed reminders?"
        confirmLabel="Re-send failed"
        message={
          <>
            <p>
              Every failed e-mail is tried again, up to three attempts per reminder.
              {failedOnPage > 0 &&
                ` This page alone shows ${failedOnPage} failure${failedOnPage === 1 ? "" : "s"}.`}
            </p>
            <p className="mt-2">
              Recipients receive the same reminder again — the run does not create a new one.
            </p>
          </>
        }
      />
    </>
  );
}
