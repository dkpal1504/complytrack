/**
 * Shapes returned by the live report API.
 *
 * These deliberately do NOT reuse `ReportResult` from `@/types/api`: that type
 * describes columns as `string[]` and rows as arrays of arrays, but the running
 * backend (`app/services/reports.py`) returns `columns` as `{key,label}` objects
 * and `rows` as dicts keyed by the column slug, plus `totals` and `summary`.
 * Handling the real shape here keeps the screens honest about what they receive.
 */

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportCatalogueEntry {
  code: string;
  name: string;
  description: string;
  columns: string[];
  group: string;
}

export interface ReportResultLive {
  code: string;
  name: string;
  generated_at: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals: Record<string, unknown>;
  summary: Record<string, unknown>;
}

export interface ScheduleInput {
  report_code: string;
  name: string;
  frequency: string;
  recipients: string[];
  format: string;
  filters: Record<string, unknown>;
}
