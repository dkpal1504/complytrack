/**
 * Small helpers shared by the four administration screens.
 *
 * The RBAC table here is a faithful transcription of the server matrix in
 * `backend/app/core/rbac.py` (PRD Section 9), which is the single source of
 * truth for authorisation. It is duplicated only so the Users screen can show
 * the matrix as a read-only reference; the server still decides every request.
 */

import type { CategoryRow, TemplateCategoryNode } from "@/features/admin/admin-types";
import { PERM } from "@/features/auth/auth-context";

/* ---------------------------- Category helpers ---------------------------- */

export interface FlatCategory {
  id: string;
  name: string;
  parentName: string | null;
  depth: number;
  colour: string | null;
}

/** Flattens the org category tree into indented rows for a `<Select>`. */
export function flattenCategories(rows: CategoryRow[]): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (nodes: CategoryRow[], depth: number, parentName: string | null) => {
    for (const node of nodes) {
      out.push({ id: node.id, name: node.name, parentName, depth, colour: node.colour });
      if (node.children?.length) walk(node.children, depth + 1, node.name);
    }
  };
  walk(rows, 0, null);
  return out;
}

/** Flattens the template category tree (same shape, different count field). */
export function flattenTemplateCategories(nodes: TemplateCategoryNode[]): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (list: TemplateCategoryNode[], depth: number, parentName: string | null) => {
    for (const node of list) {
      out.push({ id: node.id, name: node.name, parentName, depth, colour: node.colour });
      if (node.children?.length) walk(node.children, depth + 1, node.name);
    }
  };
  walk(nodes, 0, null);
  return out;
}

/** The label shown in a category picker: `Parent — Child`. */
export function categoryLabel(item: FlatCategory) {
  return item.parentName ? `${item.parentName} — ${item.name}` : item.name;
}

/* ----------------------------- Settings values ---------------------------- */

export type SettingKind = "boolean" | "number" | "string" | "json" | "null";

/** Chooses the editor a setting's current value deserves. */
export function settingKind(value: unknown): SettingKind {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "json";
}

/** A one-line summary of a setting for the list column. */
export function settingSummary(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/** Pretty JSON for the textarea editor, so the value is readable and editable. */
export function toJsonText(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Parses a JSON editor's text.
 *
 * Returns the parsed value or an error message — never throws, and never lets a
 * malformed document reach the API.
 */
export function parseJsonText(text: string): { value?: unknown; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null };
  try {
    return { value: JSON.parse(trimmed) as unknown };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "This is not valid JSON." };
  }
}

/* ------------------------------ Reminder roles ---------------------------- */

/** The audience keys the reminder engine understands (`domain/escalation.py`). */
export const RECIPIENT_ROLES: { key: string; label: string }[] = [
  { key: "owner", label: "Owner" },
  { key: "delegate", label: "Delegate" },
  { key: "department_head", label: "Department Head" },
  { key: "unit_head", label: "Unit Head" },
  { key: "plant_head", label: "Plant Head" },
  { key: "compliance", label: "Compliance Team" },
  { key: "management", label: "Management" },
  { key: "director", label: "Director / CEO" },
];

export function roleLabel(key: string) {
  return RECIPIENT_ROLES.find((role) => role.key === key)?.label ?? key.replace(/_/g, " ");
}

/** The channels the engine actually delivers today (RM-01 / phase 2 note). */
export const DELIVERING_CHANNELS = new Set(["email", "in_app", "push"]);

export const CHANNELS: { key: string; label: string; phase2?: boolean }[] = [
  { key: "email", label: "Email" },
  { key: "in_app", label: "In-app notification" },
  { key: "push", label: "Browser push" },
  { key: "sms", label: "SMS", phase2: true },
  { key: "whatsapp", label: "WhatsApp", phase2: true },
  { key: "teams", label: "Microsoft Teams", phase2: true },
];

/** Plain-English wording for an escalation trigger. */
export function triggerLabel(days: number, direction: string) {
  if (days === 0 && direction === "after") return "On the due date";
  if (direction === "after") return `${days} day${days === 1 ? "" : "s"} after the due date`;
  return `${days} day${days === 1 ? "" : "s"} before the due date`;
}

/** Human wording for a reminder offset. */
export function offsetLabel(offset: number) {
  if (offset === 0) return "On the due date";
  if (offset > 0) return `${offset} before`;
  return `${Math.abs(offset)} overdue`;
}

/* --------------------------------- RBAC ---------------------------------- */

export interface PermissionGroup {
  id: string;
  label: string;
  description: string;
  permissions: string[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "register",
    label: "Register & workflow",
    description: "Browse, edit, reassign and close obligations.",
    permissions: [
      PERM.VIEW_ALL_ITEMS,
      PERM.VIEW_SCOPED_ITEMS,
      PERM.MANAGE_ITEMS,
      PERM.UPDATE_ASSIGNED,
      PERM.REASSIGN,
      PERM.DELETE_ARCHIVE,
      PERM.VERIFY_CLOSE,
    ],
  },
  {
    id: "documents",
    label: "Documents",
    description: "Download evidence and issue share links.",
    permissions: [PERM.DOWNLOAD_DOCS, PERM.CREATE_SHARE_LINK],
  },
  {
    id: "insight",
    label: "Dashboards & reports",
    description: "Management dashboards and report runs.",
    permissions: [
      PERM.VIEW_DASHBOARD_ALL,
      PERM.VIEW_DASHBOARD_SCOPED,
      PERM.RUN_REPORTS_ALL,
      PERM.RUN_REPORTS_SCOPED,
    ],
  },
  {
    id: "financials",
    label: "Financial exposure",
    description: "Fee, penalty and exposure figures (AC-05).",
    permissions: [PERM.VIEW_FINANCIALS],
  },
  {
    id: "audit",
    label: "Audit trail",
    description: "Read and verify the immutable audit log.",
    permissions: [PERM.VIEW_AUDIT],
  },
  {
    id: "admin",
    label: "Administration",
    description: "Master data, templates, settings and the reminder engine.",
    permissions: [
      PERM.MANAGE_ORG,
      PERM.MANAGE_TEMPLATES,
      PERM.MANAGE_SETTINGS,
      PERM.CONFIGURE_ENGINE,
      PERM.MANAGE_PHASE2,
    ],
  },
];

/** Role → permissions, transcribed from `backend/app/core/rbac.py` `MATRIX`. */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  Administrator: [
    PERM.MANAGE_ORG,
    PERM.CONFIGURE_ENGINE,
    PERM.MANAGE_TEMPLATES,
    PERM.MANAGE_ITEMS,
    PERM.VIEW_ALL_ITEMS,
    PERM.UPDATE_ASSIGNED,
    PERM.DELETE_ARCHIVE,
    PERM.REASSIGN,
    PERM.VIEW_DASHBOARD_ALL,
    PERM.RUN_REPORTS_ALL,
    PERM.VIEW_AUDIT,
    PERM.DOWNLOAD_DOCS,
    PERM.MANAGE_SETTINGS,
    PERM.VIEW_FINANCIALS,
    PERM.MANAGE_PHASE2,
    PERM.CREATE_SHARE_LINK,
  ],
  "Compliance Team": [
    PERM.CONFIGURE_ENGINE,
    PERM.MANAGE_TEMPLATES,
    PERM.MANAGE_ITEMS,
    PERM.VIEW_ALL_ITEMS,
    PERM.UPDATE_ASSIGNED,
    PERM.VERIFY_CLOSE,
    PERM.DELETE_ARCHIVE,
    PERM.REASSIGN,
    PERM.VIEW_DASHBOARD_ALL,
    PERM.RUN_REPORTS_ALL,
    PERM.VIEW_AUDIT,
    PERM.DOWNLOAD_DOCS,
    PERM.VIEW_FINANCIALS,
    PERM.MANAGE_PHASE2,
    PERM.CREATE_SHARE_LINK,
  ],
  "Department User": [
    PERM.VIEW_SCOPED_ITEMS,
    PERM.UPDATE_ASSIGNED,
    PERM.VIEW_DASHBOARD_SCOPED,
    PERM.RUN_REPORTS_SCOPED,
    PERM.DOWNLOAD_DOCS,
  ],
  "Management View": [
    PERM.VIEW_ALL_ITEMS,
    PERM.VIEW_DASHBOARD_ALL,
    PERM.RUN_REPORTS_ALL,
    PERM.DOWNLOAD_DOCS,
    PERM.VIEW_FINANCIALS,
  ],
  Auditor: [PERM.VIEW_SCOPED_ITEMS, PERM.DOWNLOAD_DOCS],
};

export const RBAC_ROLES = [
  "Administrator",
  "Compliance Team",
  "Department User",
  "Management View",
  "Auditor",
] as const;

export type MatrixCoverage = "all" | "some" | "none";

/** How much of a permission group a role holds. */
export function matrixCoverage(role: string, group: PermissionGroup): MatrixCoverage {
  const held = ROLE_PERMISSIONS[role] ?? [];
  const count = group.permissions.filter((permission) => held.includes(permission)).length;
  if (count === 0) return "none";
  if (count === group.permissions.length) return "all";
  return "some";
}

/* -------------------------------- Anchors -------------------------------- */

/** Where reminders count down to (mirrors the item form's anchor choices). */
export const ANCHOR_OPTIONS = [
  { value: "renewal_due_date", label: "Renewal due date" },
  { value: "statutory_due", label: "Statutory due date" },
];

/* --------------------- Enums the meta endpoint omits ---------------------- */
/* Values transcribed from `backend/app/domain/enums.py`; `GET /meta` and
   `GET /org/lookups` do not expose these three lists. */

export const UNIT_TYPES = ["Yard", "Plant", "Office", "Subsidiary"];

export const AUTHORITY_LEVELS = ["Central", "State", "Local", "Class", "Customer", "Internal"];

export const USER_STATUSES = ["Active", "Inactive", "Locked"];
