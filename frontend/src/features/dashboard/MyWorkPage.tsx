/**
 * "My work" — the personal worklist (PRD §7.3, screen 4).
 *
 * What an owner actually opens in the morning: what is already late, what is
 * coming in the next 90 days, what is waiting on a document from them, and the
 * items they have handed to somebody else. Each block is its own table so an
 * empty one can say so plainly rather than leaving a blank panel.
 */

import { useQuery } from "@tanstack/react-query";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BucketChip, CriticalityChip } from "@/components/ui/Chip";
import { EscalationChip } from "@/components/ui/EscalationChip";
import { EmptyState, ErrorState, SkeletonCards, SkeletonRows } from "@/components/ui/Feedback";
import { PageHeader, SectionTitle, StatTile } from "@/components/ui/Page";
import { RagChip } from "@/components/ui/RagChip";
import { DataTable, type Column } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { formatCountdown, formatDate } from "@/lib/format";
import { qk } from "@/lib/query";
import type { OfficerRow } from "@/types/api";

interface MyWorkDashboard {
  generated_at: string;
  open_items: OfficerRow[];
  upcoming_90: OfficerRow[];
  awaiting_upload: OfficerRow[];
  delegated: OfficerRow[];
  overdue: OfficerRow[];
  counts: { open: number; overdue: number; expired: number; escalated: number };
}

const EMPTY_COUNTS = { open: 0, overdue: 0, expired: 0, escalated: 0 };

export default function MyWorkPage() {
  const query = useQuery({
    queryKey: qk.dashboards.myWork,
    queryFn: () => api<MyWorkDashboard>("/dashboards/my-work"),
  });

  if (query.isPending) {
    return (
      <div>
        <PageHeader title="My work" description="Loading your obligations…" />
        <div className="space-y-4 px-4 py-4 sm:px-6">
          <SkeletonCards count={4} />
          <SkeletonRows rows={5} />
        </div>
      </div>
    );
  }

  if (query.error) {
    return (
      <div>
        <PageHeader title="My work" />
        <ErrorState error={query.error} onRetry={() => query.refetch()} className="py-24" />
      </div>
    );
  }

  const data = query.data;
  const counts = data?.counts ?? EMPTY_COUNTS;
  const nothingAtAll =
    (data?.overdue.length ?? 0) +
      (data?.upcoming_90.length ?? 0) +
      (data?.awaiting_upload.length ?? 0) +
      (data?.open_items.length ?? 0) +
      (data?.delegated.length ?? 0) ===
    0;

  return (
    <div>
      <PageHeader
        title="My work"
        description={
          data ? `Everything you own or are covering, as at ${formatDate(data.generated_at)}.` : undefined
        }
        actions={
          <>
            <Button
              icon="refresh"
              variant="secondary"
              onClick={() => query.refetch()}
              loading={query.isFetching}
            >
              Refresh
            </Button>
            <ButtonLink to="/register" variant="secondary" icon="list">
              Open register
            </ButtonLink>
          </>
        }
      />

      <div className="space-y-6 px-4 py-4 sm:px-6 sm:py-5">
        <section aria-label="Your workload at a glance">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Open obligations"
              value={counts.open}
              icon="list"
              tone="brand"
              hint="assigned to you or your team"
            />
            <StatTile
              label="Overdue"
              value={counts.overdue}
              icon="alert"
              tone={counts.overdue > 0 ? "critical" : "neutral"}
              hint="past the renewal due date"
            />
            <StatTile
              label="Expired"
              value={counts.expired}
              icon="x-circle"
              tone={counts.expired > 0 ? "critical" : "neutral"}
              hint="licences or certificates that have lapsed"
            />
            <StatTile
              label="Escalated"
              value={counts.escalated}
              icon="arrow-up-right"
              tone={counts.escalated > 0 ? "warning" : "neutral"}
              hint="raised to a manager"
            />
          </div>
        </section>

        {nothingAtAll ? (
          <Card>
            <EmptyState
              icon="check-circle"
              title="Nothing is assigned to you right now"
              description="When an obligation is owned by you, or delegated to you for cover, it will appear here with its renewal dates and next action."
              action={
                <ButtonLink to="/register" variant="primary" icon="list">
                  Browse the register
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <>
            <WorkSection
              title="Overdue"
              description="Past the renewal due date — clear these first."
              rows={data?.overdue ?? []}
              emptyTitle="Nothing is overdue"
              emptyDescription="Every obligation you own is inside its renewal window."
              caption="Overdue obligations you own"
            />
            <WorkSection
              title="Due in the next 90 days"
              description="Start the renewal before the window closes."
              rows={data?.upcoming_90 ?? []}
              emptyTitle="Nothing falls due in the next 90 days"
              emptyDescription="No renewal or filing you own comes due within three months."
              caption="Obligations you own that fall due within 90 days"
            />
            <WorkSection
              title="Awaiting a document"
              description="Waiting on a certificate, receipt or acknowledgement from you."
              rows={data?.awaiting_upload ?? []}
              emptyTitle="No documents are outstanding"
              emptyDescription="Nothing you own is waiting on an upload."
              caption="Obligations you own that are awaiting a document"
            />
            <WorkSection
              title="Open items"
              description="Everything you own that is not yet closed."
              rows={data?.open_items ?? []}
              emptyTitle="No open items"
              emptyDescription="Everything you own is closed or renewed."
              caption="Open obligations you own"
            />
            <WorkSection
              title="Delegated to you"
              description="Cover you have taken on, or work handed to you by a colleague."
              rows={data?.delegated ?? []}
              emptyTitle="Nothing has been delegated to you"
              emptyDescription="You are not covering anyone else's obligations at the moment."
              caption="Obligations delegated to you"
            />
          </>
        )}
      </div>
    </div>
  );
}

function WorkSection({
  title,
  description,
  rows,
  emptyTitle,
  emptyDescription,
  caption,
}: {
  title: string;
  description: string;
  rows: OfficerRow[];
  emptyTitle: string;
  emptyDescription: string;
  caption: string;
}) {
  return (
    <section>
      <SectionTitle title={title} count={rows.length} description={description} />
      <Card>
        <DataTable<OfficerRow>
          caption={caption}
          rows={rows}
          getRowId={(row) => row.item_id}
          rowHref={(row) => `/items/${row.item_id}`}
          rowTone={(row) =>
            row.rag === "red" ? "danger" : row.rag === "amber" ? "warning" : undefined
          }
          columns={MY_WORK_COLUMNS}
          empty={
            <EmptyState
              icon="check-circle"
              title={emptyTitle}
              description={emptyDescription}
              className="py-8"
            />
          }
        />
      </Card>
    </section>
  );
}

const MY_WORK_COLUMNS: Column<OfficerRow>[] = [
  {
    key: "name",
    header: "Obligation",
    isTitle: true,
    sortValue: (row) => row.name,
    cell: (row) => (
      <span>
        <span className="block font-medium text-ink">{row.name}</span>
        <span className="block text-2xs text-ink-subtle">
          {row.item_code}
          {row.unit ? ` · ${row.unit}` : ""}
        </span>
      </span>
    ),
  },
  {
    key: "criticality",
    header: "Criticality",
    mobileLabel: "Criticality",
    sortValue: (row) => row.criticality,
    cell: (row) => <CriticalityChip criticality={row.criticality} />,
  },
  {
    key: "status",
    header: "Status",
    mobileLabel: "Status",
    sortValue: (row) => row.status,
    cell: (row) => <BucketChip bucket={row.status} />,
  },
  {
    key: "rag",
    header: "RAG",
    mobileLabel: "RAG",
    sortValue: (row) => row.rag,
    cell: (row) => <RagChip rag={row.rag} />,
  },
  {
    key: "timing",
    header: "Timing",
    mobileLabel: "Timing",
    sortValue: (row) => row.days_left,
    cell: (row) => (
      <span className={row.rag === "red" ? "font-medium text-rag-red" : undefined}>
        {formatCountdown(row.days_left)}
      </span>
    ),
  },
  {
    key: "expiry",
    header: "Expiry date",
    mobileLabel: "Expires",
    hideBelow: "sm",
    sortValue: (row) => row.expiry_date,
    cell: (row) => <span className="tabular">{formatDate(row.expiry_date)}</span>,
  },
  {
    key: "escalation",
    header: "Escalation",
    mobileLabel: "Escalation",
    hideBelow: "sm",
    sortValue: (row) => row.escalation_level,
    cell: (row) => <EscalationChip level={row.escalation_level} />,
  },
];
