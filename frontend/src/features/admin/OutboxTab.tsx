/**
 * The e-mail outbox (RM-10).
 *
 * When SMTP is configured, nothing lands here — reminders go straight out. When
 * it is not, the engine spools each message to disk as a `.eml` file so a
 * tester can open it in a mail client. This screen exists to make that
 * difference obvious rather than leaving "we never got the reminder" a mystery.
 *
 * The API returns file metadata only; it never streams the message contents.
 */

import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { Panel, ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query";
import type { OutboxResponse } from "@/features/admin/admin-types";

export function OutboxTab() {
  const query = useQuery({
    queryKey: qk.reminders.outbox,
    queryFn: () => api<OutboxResponse>("/reminders/outbox"),
  });

  const data = query.data;
  const files = data?.files ?? [];

  const columns: Column<OutboxResponse["files"][number]>[] = [
    {
      key: "name",
      header: "File",
      isTitle: true,
      sortValue: (row) => row.name,
      cell: (row) => <span className="font-mono text-xs break-all text-ink">{row.name}</span>,
    },
    {
      key: "size",
      header: "Size",
      align: "right",
      sortValue: (row) => row.size_bytes,
      cell: (row) => <span className="tabular">{formatBytes(row.size_bytes)}</span>,
    },
    {
      key: "modified",
      header: "Written",
      sortValue: (row) => row.modified_at,
      cell: (row) => <span className="tabular">{formatDateTime(row.modified_at)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Outbox</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              Messages the engine could not send because no mail server is configured. Each is
              written to disk as a standard <span className="font-mono">.eml</span> file.
            </p>
          </div>
          {data &&
            (data.smtp_configured ? (
              <Chip icon="check-circle" className="border-rag-green-border bg-rag-green-bg text-rag-green">
                SMTP configured — mail goes out directly
              </Chip>
            ) : (
              <Chip icon="alert" className="border-rag-amber-border bg-rag-amber-bg text-rag-amber">
                SMTP not configured — messages are spooled to disk
              </Chip>
            ))}
        </div>

        {data && !data.smtp_configured && (
          <div
            role="status"
            className="flex items-start gap-2 border-b border-line bg-rag-amber-bg px-4 py-3 text-xs text-ink sm:px-5"
          >
            <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-rag-amber" />
            <p>
              Nobody is receiving reminder e-mails in this environment. The messages below are the
              ones the engine intended to send. Configure SMTP under Settings in Master data to
              deliver them for real.
            </p>
          </div>
        )}

        <Toolbar label="Outbox summary">
          {data && (
            <>
              <p className="text-xs text-ink-muted">
                Spool directory:{" "}
                <span className="font-mono break-all text-ink">{data.directory}</span>
              </p>
              <ResultCount
                shown={files.length}
                total={data.count}
                noun="message"
                className="sm:ml-auto"
              />
            </>
          )}
        </Toolbar>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption="Spooled reminder messages"
            columns={columns}
            rows={files}
            getRowId={(row) => row.name}
            loading={query.isPending}
            empty={
              <EmptyState
                icon="mail"
                title={data?.smtp_configured ? "The outbox is empty" : "Nothing spooled yet"}
                description={
                  data?.smtp_configured
                    ? "Mail is being delivered directly, so nothing is written here."
                    : "No reminder has needed spooling. Run the daily job from the Jobs tab and messages will appear here."
                }
              />
            }
          />
        )}
      </Card>

      <Panel title="What lands here" icon="info">
        <ul className="space-y-1.5 text-xs text-ink-muted">
          <li className="flex gap-2">
            <Icon name="document" size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
            One file per recipient per reminder, named after the reminder so it can be matched to
            the delivery log.
          </li>
          <li className="flex gap-2">
            <Icon name="document" size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
            Each file is a complete message — open it in a mail client to see exactly what the
            recipient would have received.
          </li>
          <li className="flex gap-2">
            <Icon name="shield" size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
            Message contents are not exposed through the API; this screen shows only file metadata.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
