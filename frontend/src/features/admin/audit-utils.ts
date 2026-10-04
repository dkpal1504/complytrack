/**
 * Reading and routing an audit entry.
 *
 * AT-02 wants a route from an audit row to the record it touched. Only a few
 * entity types have a dedicated record page, so those get a precise link and
 * the rest point at the admin screen that owns them.
 */

import { titleCase } from "@/lib/format";
import type { AuditRowLive } from "@/features/admin/audit-types";

const ENTITY_ROUTES: Record<string, (id: string | null) => string> = {
  compliance_item: (id) => (id ? `/items/${id}` : ""),
  compliance_template: () => "/admin/templates",
  organisation_unit: () => "/admin/master-data",
  department: () => "/admin/master-data",
  issuing_authority: () => "/admin/master-data",
  category: () => "/admin/master-data",
  legal_reference: () => "/admin/master-data",
  holiday_calendar: () => "/admin/master-data",
  setting: () => "/admin/master-data",
  reminder_profile: () => "/admin/reminders",
  escalation_log: () => "/admin/reminders",
  email_template: () => "/admin/reminders",
  user: () => "/admin/users",
  document: () => "/documents",
  share_link: () => "/documents",
};

/** A route for the affected record, or "" when there is nowhere to send them. */
export function recordHref(entityType: string, entityId: string | null): string {
  const route = ENTITY_ROUTES[entityType];
  return route ? route(entityId) : "";
}

export function recordLabel(entityType: string): string {
  return titleCase(entityType);
}

function abbreviate(value: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = value.length > 64 ? `${value.slice(0, 63)}…` : value;
  return text;
}

/** A one-line, human summary of what a row changed. */
export function changeSummary(row: AuditRowLive): string {
  if (row.changes && typeof row.changes === "object") {
    const count = Object.keys(row.changes).length;
    return `${count} field${count === 1 ? "" : "s"} changed`;
  }
  if (row.field) {
    return `${row.field}: ${abbreviate(row.old_value)} → ${abbreviate(row.new_value)}`;
  }
  if (row.old_value || row.new_value) {
    return `${abbreviate(row.old_value)} → ${abbreviate(row.new_value)}`;
  }
  return "—";
}

/** Pretty-prints a value that may itself be a JSON string. */
export function prettyJson(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
