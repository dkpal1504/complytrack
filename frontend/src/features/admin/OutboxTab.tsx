/**
 * The e-mail outbox (RM-10).
 *
 * When SMTP is configured, nothing lands here — reminders go straight out. When
 * it is not, the engine spools each message to disk as a `.eml` file so a
 * tester can read exactly what a recipient would have received. This screen
 * exists to make that difference obvious rather than leaving "we never got the
 * reminder" a mystery.
 *
 * Opening a file shows the message the way the recipient would read it, fetched
 * from the API. The HTML part is shown as source rather than rendered: a real
 * e-mail carries its own styles, which would leak into the app around it.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { SegmentedControl } from "@/components/ui/Nav";
import { Modal } from "@/components/ui/Overlay";
import { Panel, ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query";
import type { OutboxMessage, OutboxResponse } from "@/features/admin/admin-types";

type BodyView = "message" | "source";

export function OutboxTab() {
  const [openName, setOpenName] = useState<string | null>(null);
  const [bodyView, setBodyView] = useState<BodyView>("message");

  const query = useQuery({
    queryKey: qk.reminders.outbox,
    queryFn: () => api<OutboxResponse>("/reminders/outbox"),
  });

  const message = useQuery({
    queryKey: qk.reminders.outboxMessage(openName ?? ""),
    queryFn: () => api<OutboxMessage>(`/reminders/outbox/${encodeURIComponent(openName ?? "")}`),
    enabled: openName !== null,
  });

  const data = query.data;
  const files = data?.files ?? [];

  const open = (name: string) => {
    // The message and its source are two views of one file, so reopening a
    // different message starts on the readable one again.
    setBodyView("message");
    setOpenName(name);
  };

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
      hideBelow: "sm",
      sortValue: (row) => row.size_bytes,
      cell: (row) => <span className="tabular">{formatBytes(row.size_bytes)}</span>,
    },
    {
      key: "modified",
      header: "Written",
      hideBelow: "md",
      sortValue: (row) => row.modified_at,
      cell: (row) => <span className="tabular">{formatDateTime(row.modified_at)}</span>,
    },
    {
      key: "open",
      header: <span className="sr-only">Read</span>,
      align: "right",
      cell: (row) => (
        // The row itself is clickable too; this is the visible, focusable way in.
        <Button
          size="sm"
          variant="ghost"
          icon="document"
          onClick={(event) => {
            event.stopPropagation();
            open(row.name);
          }}
        >
          Open
        </Button>
      ),
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
              ones the engine intended to send — open one to read it, or set up a mail server on the{" "}
              <span className="font-medium">E-mail (SMTP)</span> tab to deliver them for real.
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
            onRowClick={(row) => open(row.name)}
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
            <Icon name="mail-check" size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
            Each file is a complete message. Open one to read the recipient, the subject and the
            body exactly as the engine wrote it.
          </li>
          <li className="flex gap-2">
            <Icon name="info" size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
            The formatted body is offered as source rather than a live preview, because an e-mail
            brings its own styling and would not render as the recipient sees it.
          </li>
        </ul>
      </Panel>

      <Modal
        open={openName !== null}
        onClose={() => setOpenName(null)}
        title={message.data?.subject ?? "Spooled message"}
        description={openName ?? undefined}
        size="lg"
        footer={<Button onClick={() => setOpenName(null)}>Close</Button>}
      >
        {message.isPending && openName !== null ? (
          <SkeletonRows rows={5} />
        ) : message.error ? (
          <ErrorState error={message.error} onRetry={() => void message.refetch()} />
        ) : message.data ? (
          <div className="space-y-3">
            <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[6rem_1fr]">
              {(
                [
                  ["To", message.data.to],
                  ["From", message.data.from],
                  ["Sent", message.data.date],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="font-semibold text-ink-subtle">{label}</dt>
                  <dd className="min-w-0 break-all text-ink">{value ?? "—"}</dd>
                </div>
              ))}
              <div className="contents">
                <dt className="font-semibold text-ink-subtle">Size</dt>
                <dd className="text-ink">{formatBytes(message.data.size_bytes)}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedControl
                options={[
                  { value: "message", label: "Message" },
                  { value: "source", label: "HTML source" },
                ]}
                value={bodyView}
                onChange={setBodyView}
                label="Message body view"
              />
              <p className="text-2xs text-ink-subtle">
                {bodyView === "message"
                  ? "The plain-text part — what a text-only client shows"
                  : "The raw formatted body, shown as source"}
              </p>
            </div>

            <pre className="scroll-thin max-h-[50vh] overflow-auto rounded-[var(--radius-control)] border border-line bg-surface-muted p-3 text-xs whitespace-pre-wrap text-ink">
              {(bodyView === "message" ? message.data.text : message.data.html) ||
                (bodyView === "message" ? "(no plain-text body)" : "(no formatted body)")}
            </pre>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
