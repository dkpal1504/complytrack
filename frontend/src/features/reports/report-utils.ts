/**
 * Reading a report row.
 *
 * The report engine returns rows as dictionaries, but not every column key
 * matches its row key exactly: the "Timestamp (IST)" column carries the key
 * `timestamp_(ist)` while the row stores `timestamp_ist`. A small, explicit
 * resolver handles that instead of letting a cell silently render blank.
 */

import { formatCountdown, formatDate, formatMoney, formatNumber, formatPercent, titleCase } from "@/lib/format";
import type { ReportColumn, ReportResultLive } from "@/features/reports/report-types";

export interface ReportRow {
  index: number;
  values: Record<string, unknown>;
}

export type CellKind = "days" | "money" | "percent" | "number" | "text";

export function resolveCell(row: Record<string, unknown>, column: ReportColumn): unknown {
  if (Object.prototype.hasOwnProperty.call(row, column.key)) return row[column.key];
  const normalised = column.key.replace(/[()]/g, "");
  if (Object.prototype.hasOwnProperty.call(row, normalised)) return row[normalised];
  return undefined;
}

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "" || value === "—";
}

/** Classifies a column from its label, falling back to the data it holds. */
export function columnKind(column: ReportColumn, rows: ReportRow[]): CellKind {
  const label = column.label.toLowerCase();
  const key = column.key.toLowerCase();
  if (label.includes("days left")) return "days";
  if (/(exposure|fee|fees|cost|amount|inr|penalty)/.test(label)) return "money";
  if (label.includes("%") || key.endsWith("pct")) return "percent";
  const values = rows.map((row) => resolveCell(row.values, column)).filter((v) => !isBlank(v));
  if (values.length > 0 && values.every((v) => typeof v === "number")) return "number";
  return "text";
}

export interface FormattedCell {
  text: string;
  /** Rendered in a muted tone — a genuine "no value", not a blank cell. */
  muted: boolean;
  /** Numeric values line up when they are tabular. */
  tabular: boolean;
}

export function formatCell(value: unknown, kind: CellKind): FormattedCell {
  if (isBlank(value)) return { text: "—", muted: true, tabular: false };
  if (typeof value === "number") {
    switch (kind) {
      case "days":
        return { text: formatCountdown(value), muted: false, tabular: true };
      case "money":
        return { text: formatMoney(value), muted: false, tabular: true };
      case "percent":
        return { text: formatPercent(value), muted: false, tabular: true };
      case "number":
        return { text: formatNumber(value), muted: false, tabular: true };
      default:
        return { text: String(value), muted: false, tabular: true };
    }
  }
  const text = String(value);
  // The API pre-formats dates as "04-Aug-2026"; only reformat a raw ISO date.
  if (kind === "text" && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { text: formatDate(text), muted: false, tabular: false };
  }
  return { text, muted: false, tabular: false };
}

export function isNumericKind(kind: CellKind): boolean {
  return kind !== "text";
}

/**
 * Where the title cell should link.
 *
 * A report row rarely carries an item id, so when it carries the item code
 * instead we send the reader to the register filtered to that code.
 */
export function titleHref(values: Record<string, unknown>): string {
  const id = values["item_id"];
  if (typeof id === "string" && id.trim()) return `/items/${id.trim()}`;
  const code = values["item_code"] ?? values["code"];
  if (typeof code === "string" && code.trim()) return `/register?search=${encodeURIComponent(code.trim())}`;
  return "";
}

export function rowTone(values: Record<string, unknown>): "danger" | "warning" | undefined {
  const days = values["days_left"];
  if (typeof days === "number" && days < 0) return "danger";
  const state = String(values["bucket"] ?? values["status"] ?? "");
  if (/expired/i.test(state)) return "danger";
  if (/overdue/i.test(state)) return "warning";
  return undefined;
}

export interface SummaryTile {
  label: string;
  value: string;
}

/** Human tiles for the summary/totals strip the API returns. */
export function summaryTiles(result: ReportResultLive): SummaryTile[] {
  const tiles: SummaryTile[] = [];
  const seen = new Set<string>();
  for (const source of [result.summary, result.totals]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object") continue;
      const label = titleCase(key);
      if (seen.has(label)) continue;
      seen.add(label);
      tiles.push({
        label,
        value: typeof value === "number" ? formatNumber(value) : String(value),
      });
    }
  }
  return tiles;
}
