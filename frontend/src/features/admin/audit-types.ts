/**
 * Shapes returned by the live audit API (`backend/app/api/routes/audit.py`).
 *
 * The API returns `user_email` (not `user_name`) and also surfaces the hash
 * chain columns `hash` / `prev_hash` / `user_agent`, plus `changes` for
 * field-level diffs — so this is a local type rather than `AuditRow` from
 * `@/types/api`, which only carries a subset.
 */

export interface AuditRowLive {
  id: string;
  ts_utc: string;
  ts_ist: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  changes: Record<string, unknown> | null;
  reason: string | null;
  user_id: string | null;
  user_email: string | null;
  ip: string | null;
  user_agent: string | null;
  hash: string;
  prev_hash: string;
}

export interface AuditPageResult {
  total: number;
  page: number;
  page_size: number;
  rows: AuditRowLive[];
}

export interface AuditFacet {
  value: string;
  count: number;
}

export interface AuditFacets {
  entity_types: AuditFacet[];
  actions: AuditFacet[];
}

export interface AuditVerifyResult {
  intact: boolean;
  entries: number;
  head?: string;
  verified_at?: string;
  broken_at?: string;
  index?: number;
  reason?: string;
}

/** URL-backed audit filters. A type alias so `useUrlFilters` accepts it. */
export type AuditFilters = {
  entity_type: string;
  entity_id: string;
  action: string;
  user_id: string;
  period_from: string;
  period_to: string;
  search: string;
};

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  entity_type: "",
  entity_id: "",
  action: "",
  user_id: "",
  period_from: "",
  period_to: "",
  search: "",
};
