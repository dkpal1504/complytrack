/**
 * Audit trail viewer (AT-01..AT-05).
 *
 * A searchable, filterable trail with a prominent hash-chain integrity check,
 * clickable facets, a row drawer showing the full before/after payload, and a
 * tamper-evident export.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, CountBadge } from "@/components/ui/Chip";
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from "@/components/ui/Feedback";
import { Field, Input, SearchInput, Select } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { PageHeader, Panel, ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, Pagination, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, titleCase, truncate } from "@/lib/format";
import { useDebouncedValue, useUrlFilters } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { stringsToOptions, toOptions, useLookups } from "@/features/org/useReference";
import type { AuditFacets, AuditFacet, AuditPageResult, AuditRowLive, AuditVerifyResult } from "@/features/admin/audit-types";
import { EMPTY_AUDIT_FILTERS, type AuditFilters } from "@/features/admin/audit-types";
import { AuditDetailDrawer } from "@/features/admin/AuditDetailDrawer";
import { changeSummary, recordLabel } from "@/features/admin/audit-utils";
import { useReportDownload } from "@/features/reports/useReportDownload";

function FacetGroup({
  label,
  facets,
  active,
  onSelect,
}: {
  label: string;
  facets: AuditFacet[];
  active: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-2xs font-semibold tracking-wide text-ink-subtle uppercase">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {facets.map((facet) => {
          const selected = facet.value === active;
          return (
            <button
              key={facet.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(facet.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors",
                selected
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {titleCase(facet.value)}
              <CountBadge value={facet.count} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AuditPage() {
  const [selected, setSelected] = useState<AuditRowLive | null>(null);
  const { filters, setFilter, reset, activeCount, page, pageSize, setPage, setPageSize } =
    useUrlFilters<AuditFilters>(EMPTY_AUDIT_FILTERS);

  const [searchText, setSearchText] = useState(filters.search);
  const debouncedSearch = useDebouncedValue(searchText, 350);
  useEffect(() => {
    if (debouncedSearch !== filters.search) setFilter("search", debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useMemo(
    () => ({ ...filters, page, page_size: pageSize }),
    [filters, page, pageSize],
  );

  const audit = useQuery({
    queryKey: qk.audit.list(query),
    queryFn: () => api<AuditPageResult>("/audit", { query }),
    placeholderData: (previous) => previous,
  });

  const facets = useQuery({
    queryKey: qk.audit.facets,
    queryFn: () => api<AuditFacets>("/audit/facets"),
  });

  const { data: lookups } = useLookups();
  const verify = useMutation({ mutationFn: () => api<AuditVerifyResult>("/audit/verify") });
  const { run, pending } = useReportDownload();

  const clearAll = () => {
    setSearchText("");
    reset();
  };

  const exportAudit = (fmt: "csv" | "xlsx") =>
    void run(
      "/audit/export",
      { period_from: filters.period_from, period_to: filters.period_to },
      fmt,
      "Audit export",
    );

  const columns: Column<AuditRowLive>[] = [
    {
      key: "when",
      header: "When",
      isTitle: true,
      mobileLabel: "When",
      cell: (row) => <span className="tabular">{formatDateTime(row.ts_utc)}</span>,
    },
    {
      key: "user",
      header: "User",
      mobileLabel: "User",
      cell: (row) => <span className="break-all">{row.user_email ?? "—"}</span>,
    },
    {
      key: "action",
      header: "Action",
      mobileLabel: "Action",
      cell: (row) => <Chip>{titleCase(row.action)}</Chip>,
    },
    {
      key: "entity",
      header: "Entity",
      mobileLabel: "Entity",
      cell: (row) => <span title={row.entity_id ?? undefined}>{recordLabel(row.entity_type)}</span>,
    },
    {
      key: "field",
      header: "Field",
      hideBelow: "lg",
      mobileHidden: true,
      cell: (row) => row.field ?? "—",
    },
    {
      key: "change",
      header: "Change",
      mobileLabel: "Change",
      cell: (row) => <span className="text-ink-muted">{changeSummary(row)}</span>,
    },
    {
      key: "reason",
      header: "Reason",
      hideBelow: "xl",
      mobileLabel: "Reason",
      cell: (row) =>
        row.reason ? (
          <span title={row.reason}>{truncate(row.reason, 60)}</span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: "ip",
      header: "IP",
      hideBelow: "xl",
      mobileHidden: true,
      cell: (row) => <span className="tabular">{row.ip ?? "—"}</span>,
    },
  ];

  const total = audit.data?.total ?? 0;
  const shown = audit.data?.rows.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="Every create, update, delete, status change, download and sign-in is recorded here — append-only, with a tamper-evident hash chain."
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon="download"
              loading={pending === "csv"}
              disabled={pending !== null && pending !== "csv"}
              onClick={() => exportAudit("csv")}
              title="Export the selected date range as CSV"
            >
              CSV
            </Button>
            <Button
              size="sm"
              icon="download"
              loading={pending === "xlsx"}
              disabled={pending !== null && pending !== "xlsx"}
              onClick={() => exportAudit("xlsx")}
              title="Export the selected date range as Excel"
            >
              XLSX
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-4 py-5 sm:px-6">
        {/* The integrity check is a compliance control, so it leads the page. */}
        <Panel
          title="Integrity check"
          icon="shield-check"
          actions={
            <Button
              variant="primary"
              size="sm"
              icon="shield-check"
              loading={verify.isPending}
              onClick={() => verify.mutate()}
            >
              Verify integrity
            </Button>
          }
        >
          <p className="text-sm text-ink-muted">
            A passing check proves that no historical audit row has been altered or removed since it
            was written: each entry hashes the one before it, so re-walking the chain exposes any
            break.
          </p>

          {verify.data && (
            <div
              role="status"
              className={cn(
                "mt-4 flex flex-col gap-2 rounded-[var(--radius-card)] border p-3.5",
                verify.data.intact
                  ? "border-rag-green-border bg-rag-green-bg"
                  : "border-rag-red-border bg-rag-red-bg",
              )}
            >
              <p
                className={cn(
                  "flex items-center gap-2 text-sm font-semibold",
                  verify.data.intact ? "text-rag-green" : "text-rag-red",
                )}
              >
                <Icon name={verify.data.intact ? "shield-check" : "shield-alert"} size={18} />
                {verify.data.intact ? "Chain intact" : "Chain broken"}
              </p>
              {verify.data.intact ? (
                <p className="text-sm text-ink">
                  All {formatNumber(verify.data.entries)} entries verified
                  {verify.data.verified_at ? ` at ${verify.data.verified_at}` : ""}.
                </p>
              ) : (
                <p className="text-sm text-ink">
                  Verification failed at entry {verify.data.index} ({verify.data.broken_at}):{" "}
                  {verify.data.reason}.
                </p>
              )}
              {verify.data.head && (
                <p className="text-2xs break-all text-ink-muted">
                  Head hash: <span className="tabular">{verify.data.head}</span>
                </p>
              )}
            </div>
          )}

          {verify.error && (
            <p role="alert" className="mt-3 text-sm text-rag-red">
              {verify.error instanceof ApiError
                ? verify.error.detail
                : "Verification could not be completed."}
            </p>
          )}
        </Panel>

        <Panel title="Browse by entity or action" icon="filter">
          {facets.isPending && <Skeleton className="h-24 w-full" />}
          {facets.error && <ErrorState error={facets.error} onRetry={() => void facets.refetch()} />}
          {facets.data && (
            <div className="space-y-4">
              <FacetGroup
                label="Entity types"
                facets={facets.data.entity_types}
                active={filters.entity_type}
                onSelect={(value) =>
                  setFilter("entity_type", value === filters.entity_type ? "" : value)
                }
              />
              <FacetGroup
                label="Actions"
                facets={facets.data.actions}
                active={filters.action}
                onSelect={(value) => setFilter("action", value === filters.action ? "" : value)}
              />
            </div>
          )}
        </Panel>

        <Card>
          <Toolbar label="Audit filters" className="no-print">
            <SearchInput
              value={searchText}
              onChange={setSearchText}
              placeholder="Search reason, user or entity id"
              className="w-full sm:w-72"
            />
            <Field label="Entity" className="w-full sm:w-44">
              {({ id }) => (
                <Select
                  id={id}
                  placeholder="Any entity"
                  value={filters.entity_type}
                  options={stringsToOptions(facets.data?.entity_types.map((facet) => facet.value))}
                  onChange={(event) => setFilter("entity_type", event.target.value)}
                />
              )}
            </Field>
            <Field label="Action" className="w-full sm:w-44">
              {({ id }) => (
                <Select
                  id={id}
                  placeholder="Any action"
                  value={filters.action}
                  options={stringsToOptions(facets.data?.actions.map((facet) => facet.value))}
                  onChange={(event) => setFilter("action", event.target.value)}
                />
              )}
            </Field>
            <Field label="User" className="w-full sm:w-52">
              {({ id }) => (
                <Select
                  id={id}
                  placeholder="Any user"
                  value={filters.user_id}
                  options={toOptions(lookups?.users)}
                  onChange={(event) => setFilter("user_id", event.target.value)}
                />
              )}
            </Field>
            <Field label="From (IST)" className="w-full sm:w-40">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={filters.period_from}
                  onChange={(event) => setFilter("period_from", event.target.value)}
                />
              )}
            </Field>
            <Field label="To (IST)" className="w-full sm:w-40">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={filters.period_to}
                  onChange={(event) => setFilter("period_to", event.target.value)}
                />
              )}
            </Field>
            {activeCount > 0 && (
              <div className="flex items-end pb-0.5">
                <Button size="sm" variant="ghost" icon="x" onClick={clearAll}>
                  Clear filters
                </Button>
              </div>
            )}
          </Toolbar>

          <p className="px-4 pt-2 text-2xs text-ink-subtle sm:px-5">
            Exports include the selected date range only.
          </p>

          {audit.isPending ? (
            <SkeletonRows rows={8} className="p-4" />
          ) : audit.error ? (
            <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={audit.data?.rows ?? []}
                getRowId={(row) => row.id}
                onRowClick={setSelected}
                caption="Audit trail entries, newest first"
                empty={
                  <EmptyState
                    icon="search"
                    title="No audit entries match these filters"
                    description="Try a wider date range, or clear the entity, action and user filters."
                    action={
                      activeCount > 0 ? (
                        <Button icon="x" onClick={clearAll}>
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  />
                }
              />
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 sm:px-5">
                <ResultCount shown={shown} total={total} noun="audit row" />
                {audit.isFetching && (
                  <span className="text-2xs text-ink-subtle" role="status">
                    Updating…
                  </span>
                )}
              </div>
              <Pagination
                page={page}
                pages={pages}
                total={total}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={setPageSize}
              />
            </>
          )}
        </Card>
      </div>

      <AuditDetailDrawer row={selected} open={selected !== null} onClose={() => setSelected(null)} />
    </div>
  );
}
