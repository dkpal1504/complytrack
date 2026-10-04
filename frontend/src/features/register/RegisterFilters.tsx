/**
 * The register's filter bar.
 *
 * Everything here writes to the URL through `useUrlFilters` in the page, so a
 * filtered register is a link a compliance officer can send to a colleague and
 * Back retraces their steps. The long tail of filters lives behind "More
 * filters" so the bar stays one line on a tablet.
 */

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { RagDot } from "@/components/ui/Chip";
import { Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { ResultCount, Toolbar } from "@/components/ui/Page";
import { SegmentedControl } from "@/components/ui/Nav";
import { Icon } from "@/components/ui/Icon";
import { BUCKET_DRILL_LABEL, BUCKET_DRILL_OPTIONS, RAG_LABEL } from "@/lib/status";
import { stringsToOptions, toOptions } from "@/features/org/useReference";
import type { AppMeta, OrgLookups, Rag } from "@/types/api";
import type { RegisterFilters } from "@/features/register/api-types";

export type RegisterView = "table" | "cards";

const RAG_OPTIONS = (["red", "amber", "green", "grey"] as Rag[]).map((value) => ({
  value,
  label: RAG_LABEL[value],
}));

const EXPIRY_WINDOW_OPTIONS = [
  { value: "7", label: "Expiring within 7 days" },
  { value: "30", label: "Expiring within 30 days" },
  { value: "60", label: "Expiring within 60 days" },
  { value: "90", label: "Expiring within 90 days" },
  { value: "180", label: "Expiring within 180 days" },
  { value: "365", label: "Expiring within a year" },
];

const SORT_OPTIONS = [
  { value: "expiry_date", label: "Expiry date" },
  { value: "name", label: "Obligation name" },
  { value: "criticality", label: "Criticality" },
  { value: "item_code", label: "Register code" },
  { value: "created_at", label: "Recently added" },
];

const DIRECTION_OPTIONS = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
];

/** A single removable chip, plus the "clear all" that follows them. */
interface ActiveChip {
  key: keyof RegisterFilters;
  label: string;
  value: React.ReactNode;
}

function nameOf(list: { id: string; name: string }[] | undefined, id: string) {
  return list?.find((row) => row.id === id)?.name ?? "Unknown";
}

export function activeFilterChips(
  filters: RegisterFilters,
  lookups: OrgLookups | undefined,
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  const add = (key: keyof RegisterFilters, label: string, value: React.ReactNode) => {
    if (filters[key]) chips.push({ key, label, value });
  };

  add("search", "Search", `“${String(filters.search)}”`);
  if (filters.unit_id) add("unit_id", "Unit", nameOf(lookups?.units, filters.unit_id));
  if (filters.department_id)
    add("department_id", "Department", nameOf(lookups?.departments, filters.department_id));
  if (filters.category_id)
    add("category_id", "Category", nameOf(lookups?.categories, filters.category_id));
  if (filters.owner_id) add("owner_id", "Owner", nameOf(lookups?.users, filters.owner_id));
  if (filters.criticality) add("criticality", "Criticality", filters.criticality);
  if (filters.type) add("type", "Type", filters.type);
  if (filters.status) add("status", "Cycle status", filters.status);
  if (filters.derived_status) add("derived_status", "Status", filters.derived_status);
  // Arrived from a dashboard card rather than picked here, so it is labelled
  // with the card's own words and cleared from one place.
  if (filters.bucket) add("bucket", "Dashboard group", BUCKET_DRILL_LABEL[filters.bucket] ?? filters.bucket);
  if (filters.rag)
    chips.push({
      key: "rag",
      label: "RAG",
      value: (
        <span className="inline-flex items-center gap-1">
          <RagDot rag={filters.rag} />
          {RAG_LABEL[filters.rag]}
        </span>
      ),
    });
  if (filters.tag) add("tag", "Tag", filters.tag);
  if (filters.expiring_days)
    add("expiring_days", "Expiry window", `Within ${filters.expiring_days} days`);
  if (filters.include_archived)
    chips.push({ key: "include_archived", label: "Archived", value: "Included" });
  return chips;
}

export interface RegisterFilterBarProps {
  filters: RegisterFilters;
  setFilter: (key: keyof RegisterFilters, value: unknown) => void;
  setFilters: (patch: Partial<RegisterFilters>) => void;
  reset: () => void;
  searchDraft: string;
  onSearchDraft: (next: string) => void;
  activeCount: number;
  shown: number;
  total: number;
  lookups: OrgLookups | undefined;
  meta: AppMeta | undefined;
  view: RegisterView;
  onView: (next: RegisterView) => void;
  /** Right-hand bulk toolbar actions (export, import, new). */
  actions?: React.ReactNode;
}

export function RegisterFilterBar({
  filters,
  setFilter,
  setFilters,
  reset,
  searchDraft,
  onSearchDraft,
  activeCount,
  shown,
  total,
  lookups,
  meta,
  view,
  onView,
  actions,
}: RegisterFilterBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const chips = activeFilterChips(filters, lookups);

  return (
    <>
      <Toolbar label="Register filters">
        <div className="w-full sm:w-72">
          <label htmlFor="register-search" className="sr-only">
            Search obligations
          </label>
          <div className="relative">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
            />
            <input
              id="register-search"
              type="search"
              value={searchDraft}
              onChange={(event) => onSearchDraft(event.target.value)}
              placeholder="Search name, code or reference…"
              className="h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface pr-9 pl-9 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none sm:h-10"
            />
            {searchDraft && (
              <button
                type="button"
                onClick={() => onSearchDraft("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-ink"
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-none sm:flex sm:flex-wrap sm:items-center">
          <Select
            aria-label="Filter by unit"
            value={filters.unit_id}
            onChange={(event) => setFilter("unit_id", event.target.value)}
            placeholder="All units"
            options={toOptions(lookups?.units, { withCode: true })}
            className="w-full sm:w-40"
          />
          <Select
            aria-label="Filter by department"
            value={filters.department_id}
            onChange={(event) => setFilter("department_id", event.target.value)}
            placeholder="All departments"
            options={toOptions(lookups?.departments)}
            className="w-full sm:w-44"
          />
          <Select
            aria-label="Filter by category"
            value={filters.category_id}
            onChange={(event) => setFilter("category_id", event.target.value)}
            placeholder="All categories"
            options={toOptions(lookups?.categories)}
            className="w-full sm:w-44"
          />
          <Select
            aria-label="Filter by criticality"
            value={filters.criticality}
            onChange={(event) => setFilter("criticality", event.target.value)}
            placeholder="Any criticality"
            options={stringsToOptions(meta?.criticality)}
            className="w-full sm:w-40"
          />
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button
            icon="sliders"
            onClick={() => setMoreOpen(true)}
            className="flex-1 sm:flex-none"
            aria-haspopup="dialog"
          >
            More filters
            {activeCount > 0 && (
              <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-2xs font-semibold text-white">
                {activeCount}
              </span>
            )}
          </Button>
          <SegmentedControl<RegisterView>
            label="Register layout"
            value={view}
            onChange={onView}
            options={[
              { value: "table", label: "Table", icon: "list" },
              { value: "cards", label: "Cards", icon: "columns" },
            ]}
          />
        </div>

        <div className="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto">
          <ResultCount shown={shown} total={total} />
          {actions}
        </div>
      </Toolbar>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:px-5">
          <span className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">
            Filters
          </span>
          {chips.map((chip) => (
            <span
              key={String(chip.key)}
              className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-0.5 pr-1 pl-2.5 text-2xs font-medium text-brand-700"
            >
              <span className="text-ink-muted">{chip.label}:</span>
              {chip.value}
              <button
                type="button"
                onClick={() =>
                  setFilter(
                    chip.key,
                    typeof filters[chip.key] === "boolean" ? false : "",
                  )
                }
                aria-label={`Clear ${chip.label} filter`}
                className="rounded-full p-0.5 text-ink-subtle hover:bg-brand-100 hover:text-ink"
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={reset}>
            Clear all
          </Button>
        </div>
      )}

      <MoreFiltersDialog
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        filters={filters}
        setFilter={setFilter}
        setFilters={setFilters}
        lookups={lookups}
        meta={meta}
      />
    </>
  );
}

function MoreFiltersDialog({
  open,
  onClose,
  filters,
  setFilter,
  setFilters,
  lookups,
  meta,
}: {
  open: boolean;
  onClose: () => void;
  filters: RegisterFilters;
  setFilter: (key: keyof RegisterFilters, value: unknown) => void;
  setFilters: (patch: Partial<RegisterFilters>) => void;
  lookups: OrgLookups | undefined;
  meta: AppMeta | undefined;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="More filters"
      description="Narrow the register by who owns it, how it stands and when it falls due."
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose} block className="sm:w-auto">
          Show results
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Owner">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={filters.owner_id}
              onChange={(event) => setFilter("owner_id", event.target.value)}
              placeholder="Any owner"
              options={toOptions(lookups?.users)}
            />
          )}
        </Field>

        <Field label="Obligation type">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={filters.type}
              onChange={(event) => setFilter("type", event.target.value)}
              placeholder="Any type"
              options={stringsToOptions(meta?.item_type)}
            />
          )}
        </Field>

        <Field label="Derived status" hint="Valid, Expired, Due for renewal…">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={filters.derived_status}
              onChange={(event) => setFilter("derived_status", event.target.value)}
              placeholder="Any status"
              options={stringsToOptions(meta?.derived_status)}
            />
          )}
        </Field>

        <Field label="Renewal cycle status" hint="Pending, Submitted, Renewed…">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={filters.status}
              onChange={(event) => setFilter("status", event.target.value)}
              placeholder="Any cycle status"
              options={stringsToOptions(meta?.item_status)}
            />
          )}
        </Field>

        <Field label="RAG band">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={filters.rag}
              onChange={(event) => setFilter("rag", event.target.value)}
              placeholder="Any band"
              options={RAG_OPTIONS}
            />
          )}
        </Field>

        <Field
          label="Dashboard group"
          hint="The group a management KPI card counts"
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={filters.bucket}
              onChange={(event) => setFilter("bucket", event.target.value)}
              placeholder="Every group"
              options={BUCKET_DRILL_OPTIONS}
            />
          )}
        </Field>

        <Field label="Expiry window" hint="From today">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={filters.expiring_days}
              onChange={(event) => setFilter("expiring_days", event.target.value)}
              placeholder="Any expiry date"
              options={EXPIRY_WINDOW_OPTIONS}
            />
          )}
        </Field>

        <Field label="Tag" hint="Exact tag, e.g. env">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={filters.tag}
              onChange={(event) => setFilter("tag", event.target.value)}
              placeholder="Any tag"
            />
          )}
        </Field>

        <Field label="Sort by">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={filters.sort}
              onChange={(event) => setFilter("sort", event.target.value)}
              options={SORT_OPTIONS}
            />
          )}
        </Field>

        <Field label="Direction">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={filters.direction}
              onChange={(event) => setFilter("direction", event.target.value)}
              options={DIRECTION_OPTIONS}
            />
          )}
        </Field>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Include archived obligations</p>
          <p className="text-2xs text-ink-subtle">
            Archived items are kept for audit and can be restored.
          </p>
        </div>
        <input
          type="checkbox"
          checked={filters.include_archived}
          onChange={(event) => setFilters({ include_archived: event.target.checked })}
          aria-label="Include archived obligations"
          className="size-4 shrink-0 accent-[var(--color-brand-600)]"
        />
      </div>

      <div className="mt-4 flex justify-end">
        <p className="text-2xs text-ink-subtle">
          Filters live in the URL — bookmark it or send it to a colleague.
        </p>
      </div>
    </Modal>
  );
}
