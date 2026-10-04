/**
 * The responsive data table.
 *
 * One column definition drives two presentations: a real semantic table on a
 * tablet or desktop, and a stack of cards on a phone. That matters because the
 * register carries thirteen columns and a yard supervisor checks it on a
 * phone at the dock — a horizontally scrolling table there would be unusable.
 *
 * The card view is not a degraded table: each surviving column keeps its
 * header as an inline label, so nothing is ambiguous.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { SkeletonRows } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Comparable value, enabling the header to sort this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  /** Tailwind width/visibility classes for the desktop table. */
  className?: string;
  /** Hide below this breakpoint (the widest screens always show everything). */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /** The card's headline field. Exactly one column should set this. */
  isTitle?: boolean;
  /** Omit from the mobile card's label/value list. */
  mobileHidden?: boolean;
  /** A short header used as the label on the mobile card. */
  mobileLabel?: string;
}

export type SortDirection = "asc" | "desc";

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  /** Navigate to a record. Renders the whole row as a link target. */
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Screen-reader description of what the table contains. */
  caption: string;
  empty?: React.ReactNode;
  /** An extra element rendered under the card title on mobile. */
  mobileBadges?: (row: T) => React.ReactNode;
  className?: string;
  /** Highlight rows that need attention, e.g. expired obligations. */
  rowTone?: (row: T) => "danger" | "warning" | undefined;
  /** Sticky header for long registers. */
  stickyHeader?: boolean;
}

const HIDE_BELOW: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

const ALIGN: Record<string, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const ROW_TONE: Record<string, string> = {
  danger: "bg-rag-red-bg/40",
  warning: "bg-rag-amber-bg/30",
};

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // Blanks sort last, always.
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en-IN", { numeric: true, sensitivity: "base" });
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  loading = false,
  rowHref,
  onRowClick,
  caption,
  empty,
  mobileBadges,
  className,
  rowTone,
  stickyHeader = false,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    // Copy first — never mutate a prop array that React Query owns.
    return [...rows].sort(
      (a, b) => factor * compare(column.sortValue!(a), column.sortValue!(b)),
    );
  }, [columns, rows, sort]);

  const toggleSort = (column: Column<T>) => {
    if (!column.sortValue) return;
    setSort((current) => {
      if (current?.key !== column.key) return { key: column.key, direction: "asc" };
      if (current.direction === "asc") return { key: column.key, direction: "desc" };
      return null; // Third click clears the sort.
    });
  };

  if (loading) return <SkeletonRows rows={8} className={className} />;
  if (!sorted.length && empty) return <>{empty}</>;

  return (
    <div className={className}>
      {/* ---------------- Desktop / tablet: a real table ---------------- */}
      <div className={cn("scroll-thin hidden overflow-x-auto md:block")}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className={cn(stickyHeader && "sticky top-0 z-10")}>
            <tr className="border-b border-line bg-surface-muted">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                    className={cn(
                      "px-3 py-2.5 text-2xs font-semibold tracking-wide text-ink-muted uppercase",
                      ALIGN[column.align ?? "left"],
                      column.className,
                      column.hideBelow && HIDE_BELOW[column.hideBelow],
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded hover:text-ink",
                          "focus-visible:outline-2",
                          column.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {column.header}
                        <Icon
                          name={active ? "arrow-down-up" : "sort"}
                          size={12}
                          className={cn(!active && "opacity-40")}
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const href = rowHref?.(row);
              const tone = rowTone?.(row);
              return (
                <tr
                  key={getRowId(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-line last:border-0",
                    tone && ROW_TONE[tone],
                    (href || onRowClick) && "cursor-pointer transition-colors hover:bg-surface-muted",
                  )}
                >
                  {columns.map((column) => {
                    const content = column.cell(row);
                    return (
                      <td
                        key={column.key}
                        className={cn(
                          "px-3 py-2.5 align-middle text-ink",
                          ALIGN[column.align ?? "left"],
                          column.className,
                          column.hideBelow && HIDE_BELOW[column.hideBelow],
                        )}
                      >
                        {href && column.isTitle ? (
                          // Only the title cell is a link, so the whole row is
                          // still reachable by keyboard without twelve tab stops.
                          <Link
                            to={href}
                            className="font-medium text-brand-700 hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---------------------- Phone: a stack of cards ---------------------- */}
      <ul className="space-y-2.5 md:hidden">
        {sorted.map((row) => {
          const titleColumn = columns.find((c) => c.isTitle) ?? columns[0];
          const detailColumns = columns.filter(
            (c) => c !== titleColumn && !c.mobileHidden && c.hideBelow !== "sm",
          );
          const href = rowHref?.(row);
          const tone = rowTone?.(row);
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {titleColumn.cell(row)}
                </div>
                {mobileBadges?.(row)}
              </div>
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
                {detailColumns.map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">
                      {column.mobileLabel ?? column.header}
                    </dt>
                    <dd className="mt-0.5 text-xs break-words text-ink">{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </>
          );

          return (
            <li key={getRowId(row)}>
              <div
                className={cn(
                  "rounded-[var(--radius-card)] border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]",
                  tone === "danger" && "border-rag-red-border",
                  tone === "warning" && "border-rag-amber-border",
                )}
              >
                {href ? (
                  <Link to={href} className="block">
                    {body}
                  </Link>
                ) : onRowClick ? (
                  <button type="button" onClick={() => onRowClick(row)} className="block w-full text-left">
                    {body}
                  </button>
                ) : (
                  body
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Server-side pagination controls. */
export function Pagination({
  page,
  pages,
  total,
  pageSize,
  onPage,
  onPageSize,
  className,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (next: number) => void;
  onPageSize?: (next: number) => void;
  className?: string;
}) {
  if (pages <= 1 && !onPageSize) return null;

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5",
        className,
      )}
    >
      <p className="tabular text-xs text-ink-muted">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            aria-label="Rows per page"
            className="h-9 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-xs text-ink"
          >
            {[25, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className="inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-surface text-ink-muted disabled:opacity-40"
          >
            <Icon name="chevron-left" size={15} />
          </button>
          <span className="tabular px-2 text-xs text-ink-muted">
            Page {page} of {Math.max(pages, 1)}
          </span>
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page >= pages}
            aria-label="Next page"
            className="inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-surface text-ink-muted disabled:opacity-40"
          >
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
      </div>
    </nav>
  );
}
