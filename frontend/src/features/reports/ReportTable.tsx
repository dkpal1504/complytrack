/**
 * Maps a report's `columns`/`rows` payload onto the shared `DataTable`.
 *
 * The first column is the title column and links to the underlying record when
 * the row carries an item id or code. Numeric columns are right-aligned and
 * tabular; days-left becomes a phrase and money/percent use the house formats.
 */

import { DataTable, type Column } from "@/components/ui/Table";
import { cn } from "@/lib/cn";
import { truncate } from "@/lib/format";
import type { ReportResultLive } from "@/features/reports/report-types";
import {
  columnKind,
  formatCell,
  isNumericKind,
  resolveCell,
  rowTone as computeRowTone,
  titleHref,
  type CellKind,
  type ReportRow,
} from "@/features/reports/report-utils";

function ReportCell({ value, kind }: { value: unknown; kind: CellKind }) {
  const { text, muted, tabular } = formatCell(value, kind);
  const long = text.length > 80;
  return (
    <span
      className={cn(tabular && "tabular", muted && "text-ink-subtle")}
      title={long ? text : undefined}
    >
      {long ? truncate(text, 80) : text}
    </span>
  );
}

export function ReportTable({ result }: { result: ReportResultLive }) {
  const rows: ReportRow[] = result.rows.map((values, index) => ({ index, values }));
  const kinds = new Map(result.columns.map((column) => [column.key, columnKind(column, rows)]));

  const columns: Column<ReportRow>[] = result.columns.map((column, index) => {
    const kind = kinds.get(column.key) ?? "text";
    return {
      key: column.key,
      header: column.label,
      isTitle: index === 0,
      align: isNumericKind(kind) ? "right" : "left",
      mobileLabel: column.label,
      sortValue: (row) => {
        const value = resolveCell(row.values, column);
        if (value === null || value === undefined || value === "") return null;
        return typeof value === "number" ? value : String(value);
      },
      cell: (row) => <ReportCell value={resolveCell(row.values, column)} kind={kind} />,
    };
  });

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(row) => String(row.index)}
      rowHref={(row) => titleHref(row.values)}
      rowTone={(row) => computeRowTone(row.values)}
      caption={`${result.code} ${result.name} — ${rows.length} row${rows.length === 1 ? "" : "s"}`}
    />
  );
}
