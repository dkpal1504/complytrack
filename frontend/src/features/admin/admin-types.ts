/**
 * Response shapes for the administration endpoints.
 *
 * These live here, rather than in `@/types/api.ts` (which another agent owns),
 * because several admin endpoints deliberately return plain arrays rather than
 * the `Paginated<T>` envelope, and a few field names differ from the register
 * types. Each interface names the route it mirrors so the drift is visible.
 */

/* ------------------------------- Templates ------------------------------- */

/** `GET /templates` — a plain array, not paginated. */
export interface TemplateRow {
  id: string;
  code: string;
  name: string;
  type: string;
  category_id: string | null;
  category_name: string | null;
  authority_id: string | null;
  authority_name: string | null;
  default_validity_value: number | null;
  default_validity_unit: string;
  recurrence_rule: string;
  lead_time_days: number;
  authority_processing_days: number;
  internal_prep_days: number;
  criticality: string;
  default_owner_dept_id: string | null;
  department_name: string | null;
  required_documents: string[];
  legal_reference_text: string | null;
  applicability_notes: string | null;
  is_seed: boolean;
  item_count: number;
}

/**
 * `GET /templates/{id}` — a narrower shape than the list: it carries the
 * edit-only fields and omits the joined names and the item count.
 */
export interface TemplateDetail {
  id: string;
  code: string;
  name: string;
  type: string;
  category_id: string | null;
  sub_category_id: string | null;
  authority_id: string | null;
  default_validity_value: number | null;
  default_validity_unit: string;
  recurrence_rule: string;
  recurrence_day: number | null;
  recurrence_interval_months: number | null;
  lead_time_days: number;
  authority_processing_days: number;
  internal_prep_days: number;
  criticality: string;
  default_owner_dept_id: string | null;
  required_documents: string[];
  legal_reference_text: string | null;
  applicability_notes: string | null;
  allow_direct_close: boolean;
  anchor_on: string;
  is_seed: boolean;
}

/** `GET /templates/categories/tree` — roots with their children. */
export interface TemplateCategoryNode {
  id: string;
  name: string;
  colour: string | null;
  template_count: number;
  children?: TemplateCategoryNode[];
}

/** `POST /templates/apply` — dry-run and commit return the same shape. */
export interface ApplyTemplateResult {
  created: number;
  skipped: number;
  details: {
    template: string;
    status: string;
    item_code?: string;
    item_id?: string;
    expiry_date?: string | null;
  }[];
}

/* ------------------------------ Master data ------------------------------ */

/** `GET /org/units` — a plain array. */
export interface UnitRow {
  id: string;
  code: string;
  name: string;
  type: string;
  parent_id: string | null;
  address: string | null;
  state: string | null;
  gstin: string | null;
  active: boolean;
  item_count: number;
}

/** `GET /org/departments` — a plain array. */
export interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  head_user_id: string | null;
  head_user_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  item_count: number;
  user_count: number;
}

/** `GET /org/authorities` — a plain array. */
export interface AuthorityRow {
  id: string;
  name: string;
  level: string;
  website: string | null;
  contact: string | null;
  default_processing_days: number;
  item_count: number;
}

/** `GET /org/categories` — a tree, roots carry their children. */
export interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  parent_name: string | null;
  colour: string | null;
  sort_order: number;
  item_count: number;
  children: CategoryRow[];
}

/** `GET /org/legal-references` — a plain array; there is no URL field. */
export interface LegalReferenceRow {
  id: string;
  act_rule_name: string;
  section: string | null;
  jurisdiction: string | null;
  description: string | null;
}

/** `GET /org/holidays` — a plain array; `state` is the only filter. */
export interface HolidayRow {
  id: string;
  state: string;
  date: string;
  name: string;
}

/** `GET /org/settings` — `value` is any JSON scalar, array or object. */
export interface SettingRow {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
}

/* --------------------------------- Users --------------------------------- */

/** `GET /users/access-review` — a plain array of accounts. */
export interface AccessReviewRow {
  id: string;
  name: string;
  email: string;
  employee_id: string | null;
  role: string;
  roles: string[];
  department_id: string | null;
  department_name: string | null;
  unit_ids: string[];
  unit_names: string[];
  status: string;
  mfa_enabled: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  items_owned: number;
}

/** `GET /users/orphans` — obligations whose owner is inactive or removed. */
export interface OrphanItemRow {
  id: string;
  item_code: string;
  name: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_status: string;
  unit_id: string | null;
  unit_name: string | null;
  department_id: string | null;
  department_name: string | null;
  criticality: string;
  expiry_date: string | null;
  current_status: string | null;
}

/** `GET /users/orphans` — a `{items, total}` envelope, not a plain array. */
export interface OrphansResponse {
  items: OrphanItemRow[];
  total: number;
}

/* ------------------------------- Reminders ------------------------------- */

/** `GET /reminders/profiles` — a plain array. */
export interface ReminderProfileRow {
  id: string;
  name: string;
  offsets: number[];
  channels: string[];
  recipients_by_offset: Record<string, string[]>;
  post_expiry_frequency_days: number;
  anchor_on: string;
  quiet_hours_exempt: boolean;
  is_default: boolean;
}

/** `GET /reminders/escalation-matrix`. */
export interface EscalationRuleRow {
  id: string;
  level: number;
  label: string;
  trigger_days: number;
  trigger_direction: string;
  status_condition: string[];
  notify_roles: string[];
  notify_extra: string[];
  channels: string[];
  message: string | null;
}

export interface EscalationProfileRow {
  id: string;
  name: string;
  criticality: string | null;
  is_default: boolean;
  rules: EscalationRuleRow[];
}

export interface EscalationLevelRow {
  level: number;
  label: string;
  trigger_days: number;
  trigger_direction: string;
  status_condition: string[];
  notify_roles: string[];
}

export interface EscalationMatrixResponse {
  profiles: EscalationProfileRow[];
  levels: EscalationLevelRow[];
}

/** `GET /reminders/log` — `{total, rows}`, offset/limit, no date filter. */
export interface DeliveryLogRow {
  id: string;
  instance_id: string;
  item_id: string;
  offset: number;
  is_post_expiry: boolean;
  channel: string;
  recipient: string | null;
  recipient_id: string | null;
  subject: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
  scheduled_at: string;
  read_at: string | null;
  retry_count: number;
  dedupe_key: string | null;
}

export interface DeliveryLogResponse {
  total: number;
  rows: DeliveryLogRow[];
}

/** `GET /reminders/escalation-log` — a plain array. */
export interface EscalationLogRow {
  id: string;
  instance_id: string;
  level: number;
  label: string;
  notified_to: string[];
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  outcome: string | null;
}

/** `GET /reminders/jobs` — a plain array; `stats` keys are the run counters. */
export interface JobRunRow {
  id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  stats: Record<string, number>;
}

/** `POST /reminders/run` — the counters for the run just performed. */
export interface RunNowResult {
  ran_at: string;
  reminders_sent: number;
  escalations: number;
  skipped_duplicates: number;
  failures: number;
  deferred: number;
  instances_scanned: number;
  errors: string[];
  details: Record<string, unknown>[];
}

/** `GET /reminders/templates` — a plain array with the shared placeholder list. */
export interface EmailTemplateRow {
  id: string;
  code: string;
  name: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  channel: string;
  language: string;
  placeholders: string[];
}

/** `GET /reminders/outbox` — spooled `.eml` metadata. */
export interface OutboxResponse {
  smtp_configured: boolean;
  directory: string;
  count: number;
  files: { name: string; size_bytes: number; modified_at: string }[];
}

/** `GET /reminders/outbox/{name}` — one spooled message, decoded for reading. */
export interface OutboxMessage {
  name: string;
  size_bytes: number;
  modified_at: string;
  to: string | null;
  from: string | null;
  subject: string | null;
  date: string | null;
  text: string | null;
  html: string | null;
}

/**
 * `GET /reminders/mail` — the effective SMTP configuration.
 *
 * The password is never sent; `password_set` is all the screen gets. `source`
 * says where the values came from, and `read_only` is true when the environment
 * is in charge and editing would be misleading.
 */
export interface MailConfigResponse {
  host: string;
  port: number;
  user: string;
  sender: string;
  use_tls: boolean;
  use_ssl: boolean;
  password_set: boolean;
  source: "environment" | "settings" | "unconfigured";
  read_only: boolean;
  smtp_configured: boolean;
  outbox_dir: string;
}

/** `POST /reminders/test-email` — the outcome of one test send. */
export interface TestEmailResult {
  ok: boolean;
  detail: string;
  mode: "smtp" | "spool";
  to: string;
}
