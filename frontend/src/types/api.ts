/**
 * Types mirroring the ComplyTrack REST API.
 *
 * These are hand-written against the live OpenAPI schema (`frontend/openapi.json`)
 * rather than generated, so that the names the UI actually uses — `bucket`,
 * `days_left`, `rag` — stay readable at the call site.
 */

export type Role =
  | "Administrator"
  | "Compliance Team"
  | "Department User"
  | "Management View"
  | "Auditor";

export type Criticality = "Critical" | "High" | "Medium" | "Low";
export type Rag = "red" | "amber" | "green" | "grey";
export type ItemType = "Licence" | "Filing" | "Inspection" | "Certificate" | "Policy";

/** The workflow state machine (PRD §8). */
export type ItemStatus =
  | "Pending"
  | "Under Process"
  | "Submitted"
  | "Renewed"
  | "Closed"
  | "Query Raised"
  | "On Hold"
  | "Not Applicable";

/** The derived status shown as the register chip (requirement RT-05). */
export type DerivedStatus =
  | "Valid"
  | "Upcoming"
  | "Due for Renewal"
  | "Expired"
  | "Perpetual"
  | "Not Applicable";

/** How an item counts on the management dashboard (business rule 1). */
export type ComplianceBucket =
  | "Complied"
  | "Under Process"
  | "Pending"
  | "Overdue"
  | "Expired";

export type ChecklistStatus = "Pending" | "Received" | "Not Required";
export type ReminderChannel = "email" | "in_app" | "push" | "sms" | "whatsapp" | "teams";

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  mobile?: string | null;
  employee_id?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  unit_ids?: string[];
  role: Role;
  status: "Active" | "Inactive" | string;
  mfa_enabled: boolean;
  last_login_at?: string | null;
}

export interface CurrentUser extends UserSummary {
  roles: Role[];
  permissions: string[];
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: UserSummary;
  /** Present when the account must set a new password before it can be used. */
  must_change_password?: boolean;
  mfa_required?: boolean;
  mfa_token?: string;
}

export interface AppMeta {
  app_name: string;
  default_reminder_offsets: number[];
  criticality: Criticality[];
  criticality_weight: Record<Criticality, number>;
  item_type: ItemType[];
  item_status: ItemStatus[];
  derived_status: DerivedStatus[];
  compliance_bucket: ComplianceBucket[];
  rag: Rag[];
  validity_unit: string[];
  recurrence: string[];
  applicability: string[];
  checklist_status: ChecklistStatus[];
  document_type: string[];
  roles: Role[];
  reminder_channel: ReminderChannel[];
  /** [start hour, end hour] in IST, outside which non-critical mail waits. */
  quiet_hours: [number, number];
  max_upload_mb: number;
  allowed_upload_extensions: string[];
  upload_url: string;
  support_email: string;
}

/* ------------------------------------------------------------------ *
 * Compliance register
 * ------------------------------------------------------------------ */

export interface InstanceSummary {
  id: string;
  cycle_label: string;
  status: ItemStatus;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  verification_status: string;
  escalation_level: number;
  renewal_in_process: boolean;
  delay_days: number;
  closed_at: string | null;
  new_expiry_date: string | null;
}

export interface ComplianceItemSummary {
  id: string;
  item_code: string;
  name: string;
  description: string | null;
  type: ItemType;
  category_id: string | null;
  category_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  department_id: string | null;
  department_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  delegate_id: string | null;
  authority_id: string | null;
  authority_name: string | null;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  renewal_due_date: string | null;
  internal_target_date: string | null;
  validity_value: number | null;
  validity_unit: string | null;
  criticality: Criticality;
  applicability: string;
  recurrence_rule: string | null;
  fee_amount: number | null;
  is_perpetual: boolean;
  tags: string[];
  required_documents: string[];
  current_status: DerivedStatus;
  bucket: ComplianceBucket | null;
  rag: Rag;
  days_left: number | null;
  current_instance: InstanceSummary | null;
}

export interface ComplianceItemDetail extends ComplianceItemSummary {
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
  instances: InstanceSummary[];
  open_instances: InstanceSummary[];
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

/* ------------------------------------------------------------------ *
 * Workflow instance
 * ------------------------------------------------------------------ */

export interface ChecklistEntry {
  id: string;
  document_name: string;
  status: ChecklistStatus;
  document_id: string | null;
  remark: string | null;
}

export interface WorkflowInstance {
  id: string;
  item_id: string;
  item_code?: string;
  item_name?: string;
  cycle_label: string;
  status: ItemStatus;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  submission_date: string | null;
  expected_filing_date: string | null;
  acknowledgement_no: string | null;
  new_issue_date: string | null;
  new_expiry_date: string | null;
  new_reference_number: string | null;
  verification_status: string;
  verification_remark: string | null;
  verified_at: string | null;
  on_hold_reason: string | null;
  escalation_level: number;
  closed_at: string | null;
  checklist: ChecklistEntry[];
  /** Which fields the state machine demands before the next transition. */
  missing_fields?: string[];
  allowed_transitions?: ItemStatus[];
}

export interface TimelineEntry {
  id: string;
  at: string;
  actor: string | null;
  action: string;
  detail: string | null;
  kind: "audit" | "comment" | "status" | "document" | "reminder" | string;
}

/* ------------------------------------------------------------------ *
 * Documents
 * ------------------------------------------------------------------ */

export interface DocumentRecord {
  id: string;
  item_id: string | null;
  instance_id: string | null;
  document_type: string;
  title: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  version: number;
  sha256: string;
  uploaded_by: string | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
  is_current: boolean;
  expiry_date: string | null;
  notes: string | null;
}

export interface ShareLink {
  id: string;
  token: string;
  url?: string;
  document_id: string;
  expires_at: string;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
  max_downloads: number | null;
  download_count: number;
}

/* ------------------------------------------------------------------ *
 * Dashboards
 * ------------------------------------------------------------------ */

export interface Kpi {
  key: string;
  label: string;
  value: number | string;
  unit?: string | null;
  severity: "neutral" | "good" | "warning" | "critical" | string;
  delta?: number | null;
  drill?: string | null;
}

export interface ChartDatum {
  label: string;
  key?: string;
  value: number;
  percent?: number;
}

export interface StackedDatum {
  category: string;
  values: Record<string, number>;
  total: number;
}

export interface ManagementDashboard {
  generated_at: string;
  filters: Record<string, unknown>;
  kpis: Kpi[];
  status_split: ChartDatum[];
  department_status: StackedDatum[];
  unit_status: StackedDatum[];
  category_status: ChartDatum[];
  renewal_timeline: StackedDatum[];
  index_trend: { label: string; value: number }[];
  criticality_split?: ChartDatum[];
  expiring_soon?: OfficerRow[];
  compliance_index?: {
    index: number;
    counted: number;
    complied: number;
    total_weight: number;
    complied_weight: number;
  };
}

/** One row of the officer worklist / register grid. */
export interface OfficerRow {
  item_id: string;
  item_code: string;
  name: string;
  unit: string | null;
  department: string | null;
  owner: string | null;
  criticality: Criticality;
  status: ItemStatus;
  derived_status: DerivedStatus;
  rag: Rag;
  days_overdue: number | null;
  days_left: number | null;
  expiry_date: string | null;
  cycle: string | null;
  escalation_level: number;
}

export interface OfficerDashboard {
  generated_at: string;
  tabs: Record<string, OfficerRow[]>;
}

export interface MyWorkDashboard {
  generated_at: string;
  open_items: OfficerRow[];
  upcoming_90: OfficerRow[];
  awaiting_upload: OfficerRow[];
  delegated: OfficerRow[];
  overdue: OfficerRow[];
  counts: { open: number; overdue: number; expired: number; escalated: number };
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export interface ReportDefinition {
  code: string;
  name: string;
  description: string;
  columns: string[];
  group: string;
}

export interface ReportResult {
  code: string;
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
  summary?: Record<string, unknown>;
  generated_at: string;
  total_rows: number;
}

export interface ScheduledReport {
  id: string;
  report_code: string;
  name: string;
  frequency: string;
  format: string;
  recipients: string[];
  filters: Record<string, unknown>;
  active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  created_by: string | null;
}

/* ------------------------------------------------------------------ *
 * Notifications, audit, reminders
 * ------------------------------------------------------------------ */

export interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: string;
  category: string;
  is_read: boolean;
  created_at: string;
}

export interface AuditRow {
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
  user_name?: string | null;
  ip: string | null;
}

export interface AuditPage {
  total: number;
  page: number;
  page_size: number;
  rows: AuditRow[];
}

export interface ReminderLogRow {
  id: string;
  instance_id: string;
  item_id: string;
  item_name?: string | null;
  offset: number;
  is_post_expiry: boolean;
  channel: ReminderChannel;
  recipient_id: string;
  recipient_name?: string | null;
  recipient_address: string | null;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  attempts: number;
  error: string | null;
  subject: string | null;
}

export interface EscalationLogRow {
  id: string;
  instance_id: string;
  item_id?: string | null;
  item_name?: string | null;
  level: number;
  level_label?: string;
  notified_to: string[];
  notified_names?: string[];
  triggered_at: string;
  outcome: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export interface JobRunRow {
  id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  run_date: string | null;
  stats: Record<string, number>;
  error: string | null;
}

/* ------------------------------------------------------------------ *
 * Master data
 * ------------------------------------------------------------------ */

export interface LookupRef {
  id: string;
  name: string;
  code?: string | null;
}

export interface OrgLookups {
  units: LookupRef[];
  departments: LookupRef[];
  categories: LookupRef[];
  authorities: LookupRef[];
  users: LookupRef[];
  statuses: string[];
  criticalities: string[];
  item_types: string[];
  recurrence_rules: string[];
  validity_units: string[];
  roles: string[];
}
