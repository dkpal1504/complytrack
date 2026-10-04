/**
 * The navigation model.
 *
 * One definition drives the desktop sidebar, the tablet rail, the mobile tab
 * bar and the command palette, so a screen can never appear in one and be
 * missing from another. Each entry declares the permission it needs; the shell
 * hides what the signed-in role cannot use rather than showing a link that
 * leads to a 403.
 */

import { PERM } from "@/features/auth/auth-context";
import type { IconName } from "@/components/ui/Icon";

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** A second permission satisfies the item just as well as the first. */
  permissions?: string[];
  /** Shown in the command palette and as the page tooltip. */
  description?: string;
  /** Pin to the mobile bottom bar (at most four entries should set this). */
  primary?: boolean;
  badge?: "open" | "overdue" | "none";
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "work",
    label: "Daily work",
    items: [
      {
        to: "/my-work",
        label: "My Work",
        icon: "clipboard",
        description: "Obligations assigned to you, and what is due next",
        primary: true,
        badge: "open",
      },
      {
        to: "/register",
        label: "Compliance Register",
        icon: "list",
        permissions: [PERM.VIEW_ALL_ITEMS, PERM.VIEW_SCOPED_ITEMS],
        description: "Every statutory obligation with filters and bulk actions",
        primary: true,
      },
      {
        to: "/calendar",
        label: "Renewal Calendar",
        icon: "calendar-days",
        permissions: [PERM.VIEW_ALL_ITEMS, PERM.VIEW_SCOPED_ITEMS],
        description: "What falls due, month by month",
      },
      {
        to: "/documents",
        label: "Documents",
        icon: "document",
        permissions: [PERM.DOWNLOAD_DOCS],
        description: "Certificates, challans and acknowledgements on file",
      },
    ],
  },
  {
    id: "insight",
    label: "Insight",
    items: [
      {
        to: "/dashboard",
        label: "Management Dashboard",
        icon: "dashboard",
        permissions: [PERM.VIEW_DASHBOARD_ALL, PERM.VIEW_DASHBOARD_SCOPED],
        description: "KPIs, the Compliance Index and unit-wise exposure",
        primary: true,
      },
      {
        to: "/worklist",
        label: "Officer Worklist",
        icon: "clipboard-check",
        permissions: [PERM.VIEW_ALL_ITEMS, PERM.VIEW_SCOPED_ITEMS],
        description: "Expired, due and in-flight obligations in one queue",
      },
      {
        to: "/reports",
        label: "Reports",
        icon: "report",
        permissions: [PERM.RUN_REPORTS_ALL, PERM.RUN_REPORTS_SCOPED],
        description: "The twelve statutory reports, exportable and schedulable",
      },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    items: [
      {
        to: "/admin/templates",
        label: "Obligation Templates",
        icon: "columns",
        permissions: [PERM.MANAGE_TEMPLATES, PERM.MANAGE_ITEMS],
        description: "The reusable library the register is instantiated from",
      },
      {
        to: "/admin/master-data",
        label: "Master Data",
        icon: "building",
        permissions: [PERM.MANAGE_ORG],
        description: "Units, departments, categories, authorities and holidays",
      },
      {
        to: "/admin/users",
        label: "Users & Access",
        icon: "users",
        permissions: [PERM.MANAGE_ORG],
        description: "Accounts, roles and the access-review report",
      },
      {
        to: "/admin/reminders",
        label: "Reminders & Escalation",
        icon: "bell-ring",
        permissions: [PERM.CONFIGURE_ENGINE],
        description: "Reminder profiles, escalation ladder, delivery log and jobs",
      },
      {
        to: "/admin/audit",
        label: "Audit Trail",
        icon: "audit",
        permissions: [PERM.VIEW_AUDIT],
        description: "The append-only record of every change, with chain verification",
      },
    ],
  },
  {
    id: "personal",
    label: "Personal",
    items: [
      {
        to: "/notifications",
        label: "Notifications",
        icon: "notifications",
        description: "Reminders and escalations sent to you",
      },
      {
        to: "/settings",
        label: "Settings",
        icon: "settings",
        description: "Your profile, password, second factor and theme",
      },
    ],
  },
];

/** Every item the given permission set can reach. */
export function visibleGroups(can: (permission: string) => boolean): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.permissions?.length || item.permissions.some((p) => can(p)),
    ),
  })).filter((group) => group.items.length > 0);
}

/** The four entries the phone shows along the bottom edge. */
export function primaryItems(can: (permission: string) => boolean): NavItem[] {
  return NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => item.primary)
    .filter((item) => !item.permissions?.length || item.permissions.some((p) => can(p)))
    .slice(0, 4);
}

/** Flat lookup for titles, breadcrumbs and the command palette. */
export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_GROUPS.flatMap((group) => group.items).find(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
}
