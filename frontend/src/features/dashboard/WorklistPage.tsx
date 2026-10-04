/**
 * The compliance officer's worklist (PRD §7.2, screen 3).
 *
 * The officer's day is a queue, not a report: seven action tabs, each one a
 * list of obligations that need something done to them. The tab keys come from
 * the endpoint so a change to the escalation ladder does not need a change
 * here, and the count on each tab is the number of obligations behind it.
 */

import { useQuery } from "@tanstack/react-query";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BucketChip, CriticalityChip } from "@/components/ui/Chip";
import { EscalationChip } from "@/components/ui/EscalationChip";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Form";
import { Tabs, type TabItem } from "@/components/ui/Nav";
import { PageHeader, ResultCount, Toolbar } from "@/components/ui/Page";
import { RagChip } from "@/components/ui/RagChip";
import { DataTable, type Column } from "@/components/ui/Table";
import { stringsToOptions, toOptions, useLookups } from "@/features/org/useReference";
import { api } from "@/lib/api";
import { formatCountdown, formatDate } from "@/lib/format";
import { useUrlFilters } from "@/lib/hooks";
import { qk } from "@/lib/query";
import type { OfficerRow } from "@/types/api";

interface OfficerDashboard {
  generated_at: string;
  tabs: Record<string, OfficerRow[]>;
  /** The endpoint also sends a small "what is urgent today" roll-up. */
  counts?: { expired?: number; overdue?: number; due_30?: number; escalated?: number };
}

/** A tab with rows gets its natural tone; an empty one stays quiet. */
function tabTone(key: string, count: number): TabItem["tone"] {
  if (!count) return "neutral";
  if (/expired|overdue/i.test(key)) return "danger";
  if (/renewal|due|pending/i.test(key)) return "warning";
  return "neutral";
}

export default function WorklistPage() {
  const lookups = useLookups();
  const { filters, setFilter, reset, activeCount } = useUrlFilters({
    tab: "",
    unit_id: "",
    department_id: "",
    category_id: "",
    criticality: "",
  });

  // The active tab is a client-side concern; only the scope filters go to the
  // endpoint (which returns every tab in one response).
  const apiFilters = {
    unit_id: filters.unit_id,
    department_id: filters.department_id,
    category_id: filters.category_id,
    criticality: filters.criticality,
  };

  const query = useQuery({
    queryKey: qk.dashboards.officer(apiFilters),
    queryFn: () => api<OfficerDashboard>("/dashboards/officer", { query: apiFilters }),
  });

  if (query.isPending) {
    return (
      <div>
        <PageHeader title="Officer worklist" description="Loading today's action queue…" />
        <div className="px-4 py-4 sm:px-6">
          <SkeletonRows rows={8} />
        </div>
      </div>
    );
  }

  if (query.error) {
    return (
      <div>
        <PageHeader title="Officer worklist" />
        <ErrorState error={query.error} onRetry={() => query.refetch()} className="py-24" />
      </div>
    );
  }

  const tabs = query.data?.tabs ?? {};
  const keys = Object.keys(tabs);
  const requested = String(filters.tab ?? "");
  const activeTab = requested && keys.includes(requested) ? requested : (keys[0] ?? "");
  const rows = tabs[activeTab] ?? [];

  if (!keys.length) {
    return (
      <div>
        <PageHeader
          title="Officer worklist"
          actions={
            <ButtonLink to="/reports" variant="secondary" icon="report">
              Run report
            </ButtonLink>
          }
        />
        <EmptyState
          icon="check-circle"
          title="No obligations are waiting on you"
          description="Nothing is expired, due or awaiting a submission in your scope. New work will appear here as renewal dates approach."
          className="py-24"
        />
      </div>
    );
  }

  const tabItems: TabItem[] = keys.map((key) => {
    const count = tabs[key]?.length ?? 0;
    return { id: key, label: key, count, tone: tabTone(key, count) };
  });

  return (
    <div>
      <PageHeader
        title="Officer worklist"
        description="Every obligation that needs action now, grouped by what the action is."
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
            <ButtonLink to="/reports" variant="secondary" icon="report">
              Run report
            </ButtonLink>
          </>
        }
      />

      <div className="bg-surface px-4 sm:px-5">
        <Tabs items={tabItems} value={activeTab} onChange={(id) => setFilter("tab", id)} size="sm" />
      </div>

      <Toolbar label="Worklist filters">
        <Select
          aria-label="Unit"
          className="sm:w-44"
          value={String(filters.unit_id ?? "")}
          onChange={(event) => setFilter("unit_id", event.target.value)}
          options={toOptions(lookups.data?.units, { allLabel: "All units" })}
        />
        <Select
          aria-label="Department"
          className="sm:w-52"
          value={String(filters.department_id ?? "")}
          onChange={(event) => setFilter("department_id", event.target.value)}
          options={toOptions(lookups.data?.departments, { allLabel: "All departments" })}
        />
        <Select
          aria-label="Category"
          className="sm:w-52"
          value={String(filters.category_id ?? "")}
          onChange={(event) => setFilter("category_id", event.target.value)}
          options={toOptions(lookups.data?.categories, { allLabel: "All categories" })}
        />
        <Select
          aria-label="Criticality"
          className="sm:w-44"
          value={String(filters.criticality ?? "")}
          onChange={(event) => setFilter("criticality", event.target.value)}
          options={stringsToOptions(lookups.data?.criticalities, "All criticalities")}
        />
        {activeCount > 0 && (
          <Button variant="ghost" icon="x" onClick={reset}>
            Clear filters
          </Button>
        )}
      </Toolbar>

      <div className="px-4 py-4 sm:px-6 sm:py-5">
        <div className="mb-3">
          <ResultCount shown={rows.length} total={rows.length} noun="obligation" />
        </div>
        <Card>
          <DataTable<OfficerRow>
            caption={`${activeTab} — obligations needing action`}
            rows={rows}
            getRowId={(row) => row.item_id}
            rowHref={(row) => `/items/${row.item_id}`}
            rowTone={(row) =>
              row.rag === "red" ? "danger" : row.rag === "amber" ? "warning" : undefined
            }
            stickyHeader
            columns={WORKLIST_COLUMNS}
            empty={
              <EmptyState
                icon="check-circle"
                title={`Nothing in “${activeTab}”`}
                description="This queue is clear. Widen the filters, or check another tab."
              />
            }
          />
        </Card>
      </div>
    </div>
  );
}

const WORKLIST_COLUMNS: Column<OfficerRow>[] = [
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
          {row.cycle ? ` · ${row.cycle}` : ""}
        </span>
      </span>
    ),
  },
  {
    key: "unit",
    header: "Unit",
    mobileLabel: "Unit",
    hideBelow: "lg",
    sortValue: (row) => row.unit,
    cell: (row) => row.unit ?? "—",
  },
  {
    key: "department",
    header: "Department",
    mobileLabel: "Department",
    hideBelow: "xl",
    mobileHidden: true,
    cell: (row) => row.department ?? "—",
  },
  {
    key: "owner",
    header: "Owner",
    mobileLabel: "Owner",
    hideBelow: "xl",
    mobileHidden: true,
    cell: (row) => row.owner ?? "Unassigned",
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
    // The officer feed reports its rows in dashboard buckets, not workflow states.
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
    sortValue: (row) => row.escalation_level,
    cell: (row) => <EscalationChip level={row.escalation_level} />,
  },
];
