/**
 * Orphaned obligations (PRD Section 18).
 *
 * An obligation whose owner was deactivated or removed still has a statutory
 * due date. Nothing in the system will chase it, because there is nobody to
 * chase — so this list exists to get it reassigned before the date passes.
 * Each row says, in one sentence, what goes wrong if it is left alone.
 */

import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, parseISO } from "date-fns";

import { Button } from "@/components/ui/Button";
import { Chip, CriticalityChip } from "@/components/ui/Chip";
import { ErrorState } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/query";
import type { OrphanItemRow, OrphansResponse } from "@/features/admin/admin-types";

/** The one-sentence risk, phrased for the person who has to act on it. */
function riskSentence(row: OrphanItemRow) {
  const who = row.owner_name ? `${row.owner_name} (${row.owner_status.toLowerCase()})` : "nobody";
  if (!row.expiry_date) {
    return `${who} owns this, so the renewal reminders have no one to reach — reassign it before the next cycle opens.`;
  }
  const days = differenceInCalendarDays(parseISO(row.expiry_date), new Date());
  if (days < 0) {
    return `It lapsed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago with ${who} as owner, so no one was warned — reassign and renew it now.`;
  }
  if (days <= 30) {
    return `It expires in ${days} day${days === 1 ? "" : "s"} and the owner is ${who}, so the warning will reach no one unless it is reassigned.`;
  }
  return `The owner is ${who}, so reminders will go nowhere and it will quietly approach its ${formatDate(row.expiry_date)} due date.`;
}

export function OrphansPanel() {
  const query = useQuery({
    queryKey: qk.users.orphans,
    queryFn: () => api<OrphansResponse>("/users/orphans"),
  });

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const columns: Column<OrphanItemRow>[] = [
    {
      key: "name",
      header: "Obligation",
      isTitle: true,
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.name}</p>
          <p className="tabular truncate text-2xs text-ink-subtle">{row.item_code}</p>
        </div>
      ),
    },
    {
      key: "owner",
      header: "Previous owner",
      sortValue: (row) => row.owner_name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{row.owner_name ?? "Removed account"}</p>
          <p className="truncate text-2xs text-ink-subtle">
            {row.owner_email ?? "no email"} · {row.owner_status}
          </p>
        </div>
      ),
    },
    {
      key: "unit",
      header: "Unit",
      hideBelow: "lg",
      sortValue: (row) => row.unit_name,
      cell: (row) => row.unit_name ?? "—",
    },
    {
      key: "department",
      header: "Department",
      hideBelow: "lg",
      sortValue: (row) => row.department_name,
      cell: (row) => row.department_name ?? "—",
    },
    {
      key: "criticality",
      header: "Criticality",
      sortValue: (row) => row.criticality,
      cell: (row) => <CriticalityChip criticality={row.criticality} />,
    },
    {
      key: "status",
      header: "Cycle",
      hideBelow: "md",
      sortValue: (row) => row.current_status,
      cell: (row) => (row.current_status ? <Chip>{row.current_status}</Chip> : "—"),
    },
    {
      key: "expiry",
      header: "Expires",
      sortValue: (row) => row.expiry_date,
      cell: (row) => <span className="tabular">{formatDate(row.expiry_date)}</span>,
    },
    {
      key: "risk",
      header: "Why it matters",
      hideBelow: "xl",
      mobileLabel: "Why it matters",
      cell: (row) => (
        <span className="block max-w-[30rem] text-xs text-ink-muted">{riskSentence(row)}</span>
      ),
    },
  ];

  return (
    <Panel
      title="Orphaned obligations"
      icon="user-cog"
      actions={
        <Button size="sm" icon="refresh" onClick={() => void query.refetch()}>
          Refresh
        </Button>
      }
    >
      {query.isPending ? (
        <p className="py-4 text-sm text-ink-muted">Checking for orphaned obligations…</p>
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2 py-2 text-sm text-rag-green">
          <Icon name="check-circle" size={16} />
          Every obligation has an active owner. Nothing is being missed.
        </p>
      ) : (
        <>
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-amber-border bg-rag-amber-bg px-3 py-2.5 text-xs text-rag-amber"
          >
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">
                {total} obligation{total === 1 ? "" : "s"}
              </span>{" "}
              {total === 1 ? "has" : "have"} an owner who is inactive or removed. Reminders for these
              rows reach nobody, so their due dates can pass unnoticed. Open a row and reassign it.
            </span>
          </div>
          <DataTable
            caption="Obligations whose owner is inactive or removed"
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            rowHref={(row) => `/items/${row.id}`}
            rowTone={() => "warning"}
            empty={<p className="py-6 text-center text-sm text-ink-muted">Nothing to show.</p>}
          />
        </>
      )}
    </Panel>
  );
}
