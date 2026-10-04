/**
 * The obligation template library (CD-01).
 *
 * Templates are the catalogue the register is instantiated from. This screen
 * browses them by category, lets the Compliance Team edit the definition, and
 * applies a template to a unit to create a live obligation.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { CriticalityChip, Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, useToast } from "@/components/ui/Feedback";
import { SearchInput, Select } from "@/components/ui/Form";
import { PageHeader, ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, Pagination, type Column } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { useDebouncedValue, useUrlFilters } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { useMeta } from "@/features/org/useReference";
import { TemplateCategoryRail } from "@/features/admin/TemplateCategoryRail";
import { TemplateFormDrawer } from "@/features/admin/TemplateFormDrawer";
import { TemplateApplyDrawer } from "@/features/admin/TemplateApplyDrawer";
import type { TemplateCategoryNode, TemplateRow } from "@/features/admin/admin-types";

export default function TemplatesPage() {
  const { can } = useAuth();
  const canManage = can(PERM.MANAGE_TEMPLATES);
  const canApply = can(PERM.MANAGE_ITEMS);
  const toast = useToast();

  const { filters, setFilter, reset, activeCount, page, pageSize, setPage, setPageSize } =
    useUrlFilters({
      search: "",
      category_id: "",
      criticality: "",
      type: "",
      source: "",
    });

  const [searchText, setSearchText] = useState(String(filters.search ?? ""));
  const debouncedSearch = useDebouncedValue(searchText, 300);

  useEffect(() => {
    if (debouncedSearch !== filters.search) setFilter("search", debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: qk.templates.list({ search: filters.search, category_id: filters.category_id }),
    queryFn: () =>
      api<TemplateRow[]>("/templates", {
        query: { search: filters.search, category_id: filters.category_id },
      }),
  });

  const tree = useQuery({
    queryKey: qk.templates.tree,
    queryFn: () => api<TemplateCategoryNode[]>("/templates/categories/tree"),
    staleTime: 5 * 60_000,
  });

  const meta = useMeta();

  /** The API filters only by search and category, so the rest is client-side. */
  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    return rows.filter((row) => {
      if (filters.criticality && row.criticality !== filters.criticality) return false;
      if (filters.type && row.type !== filters.type) return false;
      if (filters.source === "seed" && !row.is_seed) return false;
      if (filters.source === "custom" && row.is_seed) return false;
      return true;
    });
  }, [query.data, filters.criticality, filters.type, filters.source]);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.criticality, filters.type, filters.source, filters.category_id, filters.search]);

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );
  const pages = Math.max(Math.ceil(filtered.length / pageSize), 1);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyTemplate, setApplyTemplate] = useState<TemplateRow | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setFormOpen(true);
  };
  const openEdit = (row: TemplateRow) => {
    setEditingId(row.id);
    setFormOpen(true);
  };
  const openApply = (row: TemplateRow | null) => {
    setApplyTemplate(row);
    setApplyOpen(true);
  };

  const columns: Column<TemplateRow>[] = [
    {
      key: "code",
      header: "Code",
      isTitle: false,
      className: "whitespace-nowrap",
      sortValue: (row) => row.code,
      cell: (row) => <span className="font-medium tabular text-ink">{row.code}</span>,
    },
    {
      key: "name",
      header: "Template",
      isTitle: true,
      sortValue: (row) => row.name,
      cell: (row) => (
        <span className="block max-w-[22rem] truncate font-medium text-ink" title={row.name}>
          {row.name}
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideBelow: "md",
      mobileLabel: "Category",
      sortValue: (row) => row.category_name,
      cell: (row) => row.category_name ?? "—",
    },
    {
      key: "type",
      header: "Type",
      hideBelow: "lg",
      sortValue: (row) => row.type,
      cell: (row) => titleCase(row.type),
    },
    {
      key: "criticality",
      header: "Criticality",
      sortValue: (row) => row.criticality,
      cell: (row) => <CriticalityChip criticality={row.criticality} />,
    },
    {
      key: "authority",
      header: "Authority",
      hideBelow: "xl",
      sortValue: (row) => row.authority_name,
      cell: (row) => row.authority_name ?? "—",
    },
    {
      key: "validity",
      header: "Default validity",
      hideBelow: "lg",
      mobileLabel: "Validity",
      sortValue: (row) => row.default_validity_value,
      cell: (row) =>
        row.default_validity_value
          ? `${row.default_validity_value} ${row.default_validity_unit}`
          : titleCase(row.default_validity_unit),
    },
    {
      key: "recurrence",
      header: "Recurrence",
      hideBelow: "xl",
      sortValue: (row) => row.recurrence_rule,
      cell: (row) => titleCase(row.recurrence_rule),
    },
    {
      key: "lead_time",
      header: "Lead time",
      hideBelow: "lg",
      mobileLabel: "Lead time",
      align: "right",
      sortValue: (row) => row.lead_time_days,
      cell: (row) => `${row.lead_time_days} days`,
    },
    {
      key: "source",
      header: "Source",
      sortValue: (row) => (row.is_seed ? 0 : 1),
      cell: (row) =>
        row.is_seed ? (
          <Chip icon="sparkles" title="Shipped with ComplyTrack">
            Seed
          </Chip>
        ) : (
          <Chip icon="edit" title="Created by your team">
            Custom
          </Chip>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "whitespace-nowrap",
      mobileLabel: "Actions",
      cell: (row) => (
        <div className="flex justify-end gap-1.5">
          {canManage && (
            <Button size="sm" icon="edit" onClick={() => openEdit(row)}>
              Edit
            </Button>
          )}
          {canApply && (
            <Button size="sm" variant="ghost" icon="plus" onClick={() => openApply(row)}>
              Instantiate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Obligation templates"
        description="The catalogue of statutory obligations. Instantiate a template to create a live register row with its first renewal cycle."
        actions={
          <>
            {canApply && (
              <Button
                icon="plus"
                onClick={() => openApply(null)}
                className="sm:w-auto"
                block
              >
                Instantiate into register
              </Button>
            )}
            {canManage && (
              <Button variant="primary" icon="plus" onClick={openCreate} className="sm:w-auto" block>
                New template
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <TemplateCategoryRail
            nodes={tree.data ?? []}
            selected={String(filters.category_id ?? "")}
            onSelect={(id) => setFilter("category_id", id)}
            loading={tree.isPending}
            error={tree.error}
            onRetry={() => void tree.refetch()}
          />
        </div>

        <div className="min-w-0">
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
            <Toolbar>
              <SearchInput
                value={searchText}
                onChange={setSearchText}
                placeholder="Search by code or name…"
                className="sm:w-72"
              />
              <Select
                aria-label="Category"
                value={String(filters.category_id ?? "")}
                placeholder="All categories"
                className="lg:hidden"
                options={(tree.data ?? []).flatMap((node) => [
                  { value: node.id, label: node.name },
                  ...(node.children ?? []).map((child) => ({
                    value: child.id,
                    label: `— ${child.name}`,
                  })),
                ])}
                onChange={(event) => setFilter("category_id", event.target.value)}
              />
              <Select
                aria-label="Criticality"
                value={String(filters.criticality ?? "")}
                placeholder="Any criticality"
                options={(meta.data?.criticality ?? []).map((value) => ({ value, label: value }))}
                onChange={(event) => setFilter("criticality", event.target.value)}
              />
              <Select
                aria-label="Type"
                value={String(filters.type ?? "")}
                placeholder="Any type"
                options={(meta.data?.item_type ?? []).map((value) => ({ value, label: value }))}
                onChange={(event) => setFilter("type", event.target.value)}
              />
              <Select
                aria-label="Source"
                value={String(filters.source ?? "")}
                placeholder="Any source"
                options={[
                  { value: "seed", label: "Seed library" },
                  { value: "custom", label: "Created by us" },
                ]}
                onChange={(event) => setFilter("source", event.target.value)}
              />
              {activeCount > 0 && (
                <Button size="sm" variant="ghost" icon="x" onClick={reset}>
                  Clear filters
                </Button>
              )}
            </Toolbar>

            {query.error ? (
              <ErrorState error={query.error} onRetry={() => void query.refetch()} />
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5 sm:px-5">
                  <ResultCount shown={pageRows.length} total={filtered.length} noun="template" />
                </div>
                <DataTable
                  caption="Obligation templates"
                  columns={columns}
                  rows={pageRows}
                  getRowId={(row) => row.id}
                  loading={query.isPending}
                  empty={
                    <EmptyState
                      icon="columns"
                      title="No templates match these filters"
                      description={
                        activeCount > 0
                          ? "Try clearing a filter, or browse a different category."
                          : "The template library is empty. Create the first template to start the register."
                      }
                      action={
                        activeCount > 0 ? (
                          <Button onClick={reset}>Clear filters</Button>
                        ) : canManage ? (
                          <Button variant="primary" icon="plus" onClick={openCreate}>
                            New template
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                />
                <Pagination
                  page={page}
                  pages={pages}
                  total={filtered.length}
                  pageSize={pageSize}
                  onPage={setPage}
                  onPageSize={setPageSize}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <TemplateFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        templateId={editingId}
        onSaved={() => {
          toast.info("Library refreshed", "The template list has been updated.");
          void query.refetch();
          void tree.refetch();
        }}
      />

      <TemplateApplyDrawer
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        template={applyTemplate}
        templates={query.data ?? []}
        onApplied={() => void query.refetch()}
      />
    </div>
  );
}
