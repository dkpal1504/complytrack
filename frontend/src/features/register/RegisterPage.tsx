/**
 * The compliance register (CD-01 … CD-10).
 *
 * This is the screen the compliance team lives in, so it is built around three
 * ideas: every filter lives in the URL so a view can be sent to a colleague,
 * the table stays readable on a phone in a yard (a stacked card rather than a
 * sideways-scrolling grid), and no bulk action can be taken without saying out
 * loud what it is about to change.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CriticalityChip, DerivedStatusChip, RagDot, StatusChip } from "@/components/ui/Chip";
import { EmptyState, SkeletonRows, useToast } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { DataTable, Pagination, type Column } from "@/components/ui/Table";
import { PageHeader } from "@/components/ui/Page";
import { api, apiFile, ApiError, saveBlob } from "@/lib/api";
import { qk } from "@/lib/query";
import { useDebouncedValue, useUrlFilters } from "@/lib/hooks";
import { formatCountdown, formatDate, truncate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { useLookups, useMeta } from "@/features/org/useReference";
import { ArchiveItemDialog } from "@/features/register/ArchiveItemDialog";
import { BulkActionBar } from "@/features/register/BulkActionBar";
import { CreateItemDialog } from "@/features/register/CreateItemDialog";
import { ImportWizard } from "@/features/register/ImportWizard";
import { RegisterCards } from "@/features/register/RegisterCards";
import { RegisterFilterBar, type RegisterView } from "@/features/register/RegisterFilters";
import { RegisterSavedViews } from "@/features/register/RegisterSavedViews";
import type { RegisterFilters, RegisterRow } from "@/features/register/api-types";
import type { Paginated } from "@/types/api";

const DEFAULTS: RegisterFilters = {
  search: "",
  unit_id: "",
  department_id: "",
  category_id: "",
  criticality: "",
  type: "",
  owner_id: "",
  tag: "",
  derived_status: "",
  rag: "",
  status: "",
  bucket: "",
  expiring_days: "",
  include_archived: false,
  sort: "expiry_date",
  direction: "asc",
};

const VIEW_KEY = "complytrack.register.view";

/**
 * One shared empty list rather than a fresh `[]` each render.
 *
 * The row list, the selection helpers and the export all key on the register
 * rows; a new array identity on every render while the page is loading would
 * recompute each of them on every render.
 */
const NO_ROWS: RegisterRow[] = [];

function readView(): RegisterView {
  try {
    return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "table";
  } catch {
    return "table";
  }
}

export default function RegisterPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { can, canAny } = useAuth();
  const meta = useMeta();
  const lookups = useLookups();

  const {
    filters,
    setFilter,
    setFilters,
    reset,
    activeCount,
    page,
    pageSize,
    setPage,
    setPageSize,
  } = useUrlFilters<RegisterFilters>(DEFAULTS);

  /* ------------------------------ search ------------------------------ */

  const [searchDraft, setSearchDraft] = useState(filters.search);
  const debouncedSearch = useDebouncedValue(searchDraft, 350);

  // Typing updates the draft; the URL catches up once the user pauses. Writing
  // on every keystroke would put dozens of entries in the browser history.
  useEffect(() => {
    if (debouncedSearch !== filters.search) setFilter("search", debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // A reset, or a saved view, must move the visible search box too.
  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  /* ------------------------------- layout ------------------------------- */

  // The table-or-cards choice is a device preference, not a filter, so it is
  // remembered locally rather than added to the shareable query string.
  const [view, setView] = useState<RegisterView>(readView);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* Storage unavailable — the choice simply is not remembered. */
    }
  }, [view]);

  /* ------------------------------- query ------------------------------- */

  const query = useMemo(() => {
    const q: Record<string, unknown> = {
      page,
      page_size: pageSize,
      sort: filters.sort,
      direction: filters.direction,
      search: filters.search,
      unit_id: filters.unit_id,
      department_id: filters.department_id,
      category_id: filters.category_id,
      criticality: filters.criticality,
      owner_id: filters.owner_id,
      type: filters.type,
      tag: filters.tag,
      derived_status: filters.derived_status,
      rag: filters.rag,
      status: filters.status,
      // What a management KPI card drills into (AC-5). Sent as the API's own
      // bucket vocabulary, so the list and the card are one computation.
      bucket: filters.bucket,
    };
    // "Expiring within N days" is the API's `expiring_before`/`expiring_after`
    // pair — the register has no single day-window parameter.
    const days = Number(filters.expiring_days);
    if (filters.expiring_days && Number.isFinite(days) && days > 0) {
      const today = new Date();
      q.expiring_after = format(today, "yyyy-MM-dd");
      q.expiring_before = format(addDays(today, days), "yyyy-MM-dd");
    }
    if (filters.include_archived) q.include_archived = true;
    return q;
  }, [filters, page, pageSize]);

  const register = useQuery({
    queryKey: qk.items.list(query),
    queryFn: () => api<Paginated<RegisterRow>>("/items", { query }),
    placeholderData: keepPreviousData,
  });

  const rows = register.data?.items ?? NO_ROWS;
  const total = register.data?.total ?? 0;
  const pages = register.data?.pages ?? 1;

  /* ----------------------------- selection ----------------------------- */

  const [selected, setSelected] = useState<string[]>([]);

  // A new page or a new filter set is a new question, so the tick boxes reset.
  useEffect(() => {
    setSelected([]);
  }, [JSON.stringify(query)]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  const clearSelection = () => setSelected([]);
  const allOnPage = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  /* ------------------------------ actions ------------------------------ */

  const canManage = can(PERM.MANAGE_ITEMS);
  const canArchive = can(PERM.DELETE_ARCHIVE);
  const canReassign = can(PERM.REASSIGN);
  const canExport = canAny(PERM.RUN_REPORTS_ALL, PERM.RUN_REPORTS_SCOPED);

  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [templating, setTemplating] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<RegisterRow | null>(null);

  const runExport = async () => {
    setExporting(true);
    try {
      // Paging and sorting are the grid's alone; everything else is a filter,
      // and the file must contain exactly the rows the grid is showing.
      const { page: _page, page_size: _size, sort: _sort, direction: _dir, ...filtersOnly } = query;
      const { blob, filename } = await apiFile("/items/export/register", {
        query: filtersOnly,
      });
      saveBlob(blob, filename);
      toast.success("Register exported", `${filename} has been downloaded.`);
    } catch (error) {
      toast.error("Export failed", error instanceof ApiError ? error.detail : undefined);
    } finally {
      setExporting(false);
      setExportOpen(false);
    }
  };

  const downloadTemplate = async () => {
    setTemplating(true);
    try {
      const { blob, filename } = await apiFile("/items/export/template");
      saveBlob(blob, filename);
      toast.success("Template downloaded", "Fill it in and import it back from this screen.");
    } catch (error) {
      toast.error("Could not download the template", error instanceof ApiError ? error.detail : undefined);
    } finally {
      setTemplating(false);
    }
  };

  /* ------------------------------ columns ------------------------------ */

  const columns = useMemo<Column<RegisterRow>[]>(() => {
    const base: Column<RegisterRow>[] = [];

    // The tick column only exists when there is something to do with a tick.
    if (selected.length > 0 || canReassign || canManage) {
      base.push({
        key: "select",
        header: (
          <input
            type="checkbox"
            checked={allOnPage}
            onChange={() => setSelected(allOnPage ? [] : rows.map((row) => row.id))}
            aria-label="Select every row on this page"
            className="size-4 accent-[var(--color-brand-600)]"
          />
        ),
        align: "center",
        className: "w-10",
        mobileHidden: true,
        cell: (row) => (
          <input
            type="checkbox"
            checked={selected.includes(row.id)}
            onChange={() => toggle(row.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${row.name}`}
            className="size-4 accent-[var(--color-brand-600)]"
          />
        ),
      });
    }

    base.push(
      {
        key: "item_code",
        header: "Code",
        isTitle: true,
        cell: (row) => <span className="tabular text-xs font-medium">{row.item_code}</span>,
        sortValue: (row) => row.item_code,
      },
      {
        key: "name",
        header: "Obligation",
        mobileLabel: "Obligation",
        cell: (row) => <span className="text-ink">{truncate(row.name, 72)}</span>,
        sortValue: (row) => row.name,
      },
      {
        key: "category_name",
        header: "Category",
        hideBelow: "lg",
        mobileHidden: true,
        cell: (row) => row.category_name ?? "—",
      },
      {
        key: "unit_name",
        header: "Unit",
        hideBelow: "md",
        cell: (row) => row.unit_name ?? "—",
      },
      {
        key: "department_name",
        header: "Department",
        hideBelow: "xl",
        mobileHidden: true,
        cell: (row) => row.department_name ?? "—",
      },
      {
        key: "owner_name",
        header: "Owner",
        hideBelow: "lg",
        cell: (row) => row.owner_name ?? <span className="text-ink-subtle">Unassigned</span>,
      },
      {
        key: "criticality",
        header: "Criticality",
        cell: (row) => <CriticalityChip criticality={row.criticality} />,
      },
      {
        key: "current_status",
        header: "Status",
        hideBelow: "md",
        mobileHidden: true,
        cell: (row) => <DerivedStatusChip status={row.current_status} />,
      },
      {
        key: "countdown",
        header: "Expiry countdown",
        mobileLabel: "Expiry",
        cell: (row) => (
          <span className="inline-flex items-center gap-1.5">
            <RagDot rag={row.rag} />
            <span
              className={cn(
                "text-xs font-medium",
                row.rag === "red" && "text-rag-red",
                row.rag === "amber" && "text-rag-amber",
                row.rag === "green" && "text-rag-green",
                row.rag === "grey" && "text-ink-muted",
              )}
            >
              {formatCountdown(row.days_left)}
            </span>
          </span>
        ),
      },
      {
        key: "expiry_date",
        header: "Expires on",
        hideBelow: "md",
        mobileHidden: true,
        cell: (row) => <span className="tabular">{formatDate(row.expiry_date)}</span>,
        sortValue: (row) => row.expiry_date,
      },
      {
        key: "cycle",
        header: "Current cycle",
        mobileLabel: "Cycle",
        cell: (row) =>
          row.current_instance ? (
            <StatusChip status={row.current_instance.status} />
          ) : (
            <span className="text-ink-subtle">No open cycle</span>
          ),
      },
    );

    if (canArchive) {
      base.push({
        key: "actions",
        header: <span className="sr-only">Row actions</span>,
        align: "right",
        // The phone card is a link; an archive button inside it would be a
        // nested control. Archiving from a phone is done on the item's page.
        mobileHidden: true,
        cell: (row) => (
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            aria-label={`Archive ${row.name}`}
            onClick={(event) => {
              event.stopPropagation();
              setArchiveTarget(row);
            }}
          />
        ),
      });
    }

    return base;
  }, [canArchive, canManage, canReassign, selected, allOnPage, rows]);

  /* -------------------------------- render -------------------------------- */

  const empty = (
    <EmptyState
      icon="search"
      title="No obligations match these filters"
      description={
        activeCount > 0
          ? "Try widening the expiry window, or clear the filters and start again."
          : "The register has no obligations in your scope yet."
      }
      action={
        activeCount > 0 ? (
          <Button icon="refresh" onClick={reset}>
            Clear all filters
          </Button>
        ) : canManage ? (
          <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
            New obligation
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <>
      <PageHeader
        title="Compliance register"
        description="Every licence, filing, inspection and certificate you are responsible for, with its renewal cycle."
        actions={
          <>
            {canExport && (
              <Button
                icon="download"
                onClick={() => (activeCount > 0 ? setExportOpen(true) : void runExport())}
                loading={exporting}
              >
                Export register
              </Button>
            )}
            {canManage && (
              <Button icon="spreadsheet" onClick={() => void downloadTemplate()} loading={templating}>
                Template
              </Button>
            )}
            {canManage && (
              <Button icon="upload" onClick={() => setImportOpen(true)}>
                Import
              </Button>
            )}
            {canManage && (
              <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
                New obligation
              </Button>
            )}
          </>
        }
      />

      <div className="px-4 py-4 sm:px-6">
        <Card className="overflow-hidden">
          <RegisterSavedViews
            currentFilters={filters}
            onApply={(patch) => {
              reset();
              setFilters(patch);
            }}
          />

          <RegisterFilterBar
            filters={filters}
            setFilter={setFilter}
            setFilters={setFilters}
            reset={reset}
            searchDraft={searchDraft}
            onSearchDraft={setSearchDraft}
            activeCount={activeCount}
            shown={rows.length}
            total={total}
            lookups={lookups.data}
            meta={meta.data}
            view={view}
            onView={setView}
          />

          {register.isError ? (
            <div className="p-4 sm:p-5">
              <EmptyState
                icon="alert-circle"
                title="Could not load the register"
                description={
                  register.error instanceof ApiError
                    ? register.error.detail
                    : "Something went wrong while loading the register."
                }
                action={
                  <Button icon="refresh" onClick={() => void register.refetch()}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : view === "table" ? (
            <>
              {register.isPending ? (
                <div className="p-4 sm:p-5">
                  <SkeletonRows rows={8} />
                </div>
              ) : (
                <DataTable<RegisterRow>
                  columns={columns}
                  rows={rows}
                  getRowId={(row) => row.id}
                  rowHref={(row) => `/items/${row.id}`}
                  caption="Compliance register: obligations with their owner, criticality, derived status, expiry countdown and current renewal cycle."
                  stickyHeader
                  rowTone={(row) =>
                    row.current_status === "Expired"
                      ? "danger"
                      : row.rag === "amber"
                        ? "warning"
                        : undefined
                  }
                  empty={empty}
                  mobileBadges={(row) => <RagDot rag={row.rag} />}
                />
              )}
            </>
          ) : (
            <div className="p-4 sm:p-5">
              {register.isPending ? (
                <SkeletonRows rows={6} />
              ) : (
                <RegisterCards
                  rows={rows}
                  selectable={canReassign || canManage}
                  selectedIds={selected}
                  onToggle={toggle}
                  empty={empty}
                />
              )}
            </div>
          )}

          {!register.isPending && !register.isError && rows.length > 0 && (
            <Pagination
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={setPageSize}
            />
          )}
        </Card>

        {activeCount > 0 && (
          <div className="mt-3 space-y-1 text-2xs text-ink-subtle">
            <p>Filters are in the address bar — copy the link to share this exact view.</p>
          </div>
        )}
      </div>

      <BulkActionBar
        selectedIds={selected}
        onClear={clearSelection}
        canReassign={canReassign}
        canEdit={canManage}
      />

      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} />

      <CreateItemDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(item) => navigate(`/items/${item.id}`)}
      />

      <ArchiveItemDialog
        open={Boolean(archiveTarget)}
        itemId={archiveTarget?.id ?? ""}
        itemLabel={archiveTarget ? `${archiveTarget.item_code} · ${archiveTarget.name}` : ""}
        mode="archive"
        onClose={() => setArchiveTarget(null)}
        onDone={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onConfirm={() => void runExport()}
        tone="primary"
        confirmLabel="Export"
        loading={exporting}
        title="Export the register?"
        message={
          <>
            {activeCount > 0 ? (
              <>
                The workbook will contain the {total} obligation{total === 1 ? "" : "s"} matching
                the filters on this screen, within your scope — not the whole register.
              </>
            ) : (
              <>
                No filters are set, so the workbook will contain the whole register within your
                scope: {total} obligation{total === 1 ? "" : "s"}.
              </>
            )}
          </>
        }
      />
    </>
  );
}
