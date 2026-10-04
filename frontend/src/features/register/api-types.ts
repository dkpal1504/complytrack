/**
 * The register's view of the API.
 *
 * `src/types/api.ts` is the shared vocabulary, but a handful of live payloads
 * do not match it exactly — the service serialisers return `open_instances` as
 * a number (not a list), the cycle summary carries a few extra keys, the
 * timeline uses `ts/ts_display/title`, and the workflow instance is not
 * described there at all. Rather than change the shared file (which every
 * other screen owns) the differences are declared here, once, next to the
 * screens that consume them. Nothing here invents data: every field is one the
 * routers actually return (checked against the live OpenAPI responses).
 */

import type {
  ChecklistStatus,
  ComplianceItemSummary,
  Criticality,
  ItemStatus,
  Rag,
} from "@/types/api";

/* ------------------------------------------------------------------ *
 * One cycle, as returned inside GET /items/{id}
 * (app/api/routes/items.py get_item -> payload["instances"])
 * ------------------------------------------------------------------ */

export interface InstanceProgress {
  total: number;
  received: number;
  pending: number;
  percent: number;
}

export interface CycleSummary {
  id: string;
  cycle_label: string;
  status: ItemStatus;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  verification_status: string;
  escalation_level: number;
  delay_days: number;
  closed_at: string | null;
  new_reference_number: string | null;
  new_issue_date: string | null;
  new_expiry_date: string | null;
  acknowledgement_no: string | null;
  fee_paid: number | null;
  renewal_in_process: boolean;
  progress: InstanceProgress;
}

/** GET /items/{id} — the register summary plus the detail-only columns. */
export interface ItemDetail extends ComplianceItemSummary {
  sub_category_id: string | null;
  approver_id: string | null;
  reviewer_id: string | null;
  person_ref: string | null;
  asset_id: string | null;
  anchor_on: string | null;
  grace_period_days: number | null;
  penalty_per_day: number | null;
  exposure_note: string | null;
  remarks: string | null;
  applicability_justification: string | null;
  allow_direct_close: boolean;
  reminder_profile_id: string | null;
  escalation_profile_id: string | null;
  template_id: string | null;
  legal_reference_text: string | null;
  delete_reason: string | null;
  created_at: string;
  updated_at: string;
  /** A count on this endpoint, though the shared type calls it a list. */
  open_instances: number;
  instances: CycleSummary[];
}

/* ------------------------------------------------------------------ *
 * Renewal cycle — GET /instances/{id}
 * ------------------------------------------------------------------ */

export interface ChecklistLine {
  id: string;
  item_name: string;
  status: ChecklistStatus;
  sort_order: number;
  received_at: string | null;
  /** Free text against the line — a challan number, or why it is not needed. */
  notes: string | null;
}

export interface WorkflowInstanceResponse {
  id: string;
  item_id: string;
  item_code?: string;
  item_name?: string;
  criticality?: Criticality;
  cycle_label: string;
  status: ItemStatus;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  expected_filing_date: string | null;
  submission_date: string | null;
  acknowledgement_no: string | null;
  new_reference_number: string | null;
  new_issue_date: string | null;
  new_expiry_date: string | null;
  fee_paid: number | null;
  verification_status: string;
  verification_remark: string | null;
  verified_at: string | null;
  escalation_level: number;
  delay_days: number;
  on_hold_reason: string | null;
  review_date: string | null;
  renewal_in_process: boolean;
  closed_at: string | null;
  progress: InstanceProgress;
  checklist: ChecklistLine[];
}

/* ------------------------------------------------------------------ *
 * Timeline — GET /instances/{id}/timeline
 * (app/schemas/compliance.TimelineEntry)
 * ------------------------------------------------------------------ */

export interface TimelineEntry {
  ts: string;
  ts_display: string;
  kind: string;
  title: string;
  detail: string | null;
  actor: string | null;
  severity: string;
}

/* ------------------------------------------------------------------ *
 * Workflow catalogue — GET /items/status-options
 * ------------------------------------------------------------------ */

export interface TransitionOption {
  target: ItemStatus;
  label: string;
  /** Role names, or the literal "owner" when the caller owns the item. */
  roles: string[];
  /** Field names the API demands before it will accept the move. */
  requires: string[];
  requires_reason: boolean;
}

export interface StatusOptions {
  statuses: ItemStatus[];
  transitions: Record<string, TransitionOption[]>;
}

/* ------------------------------------------------------------------ *
 * Saved views — GET /items/saved-views
 * ------------------------------------------------------------------ */

export interface SavedView {
  key: string;
  name: string;
  columns: string[];
  /** A partial register filter set. */
  filters: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Import / export — POST /items/import/*
 * ------------------------------------------------------------------ */

export interface ImportIssue {
  row: number;
  column: string | null;
  severity: string;
  message: string;
}

export interface ImportPreviewRow {
  row: number;
  unit: string | null;
  department: string | null;
  category: string | null;
  name: string;
  type: string;
  authority: string | null;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  owner: string | null;
  criticality: string;
  recurrence: string;
}

export interface ImportPreviewResult {
  total_rows: number;
  valid_rows: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  preview: ImportPreviewRow[];
  columns_detected: string[];
}

export interface ImportCommitResult {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportIssue[];
  item_ids: string[];
}

/** Row shape the register table and the RAG card grid both consume. */
export type RegisterRow = ComplianceItemSummary;

/** The filter keys the register stores in the URL. */
export interface RegisterFilters extends Record<string, unknown> {
  search: string;
  unit_id: string;
  department_id: string;
  category_id: string;
  criticality: string;
  type: string;
  owner_id: string;
  tag: string;
  derived_status: string;
  rag: Rag | "";
  status: ItemStatus | "";
  /**
   * The compliance group a management KPI card counts, as carried in that
   * card's `drill`. "all" is every obligation in scope; "due30" is the rolling
   * 30-day window; the rest are bucket names. Set by clicking a card — it is
   * the one filter a user is more likely to arrive with than to pick.
   */
  bucket: string;
  /** "Expiring within N days" — translated to expiring_before/after. */
  expiring_days: string;
  include_archived: boolean;
  sort: string;
  direction: string;
}
