import { createContext, useContext } from "react";

import type { CurrentUser, Role } from "@/types/api";

export interface AuthState {
  user: CurrentUser | null;
  /** True while the stored session is being checked on first paint. */
  loading: boolean;
  /** Set when the last sign-in attempt failed, for the login form to show. */
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  completeMfa: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** True when the signed-in user holds the given permission. */
  can: (permission: string) => boolean;
  /** True when the user holds any one of the permissions. */
  canAny: (...permissions: string[]) => boolean;
  hasRole: (...roles: Role[]) => boolean;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}

/* The permission strings the API issues, named once so a typo is a compile
   error rather than a silently hidden button. Verified against
   GET /api/v1/auth/me for each of the five seeded roles. */
export const PERM = {
  VIEW_ALL_ITEMS: "view_all_items",
  VIEW_SCOPED_ITEMS: "view_scoped_items",
  MANAGE_ITEMS: "manage_items",
  UPDATE_ASSIGNED: "update_assigned",
  REASSIGN: "reassign",
  DELETE_ARCHIVE: "delete_archive",
  VERIFY_CLOSE: "verify_close",
  DOWNLOAD_DOCS: "download_docs",
  CREATE_SHARE_LINK: "create_share_link",
  VIEW_FINANCIALS: "view_financials",
  VIEW_DASHBOARD_ALL: "view_dashboard_all",
  VIEW_DASHBOARD_SCOPED: "view_dashboard_scoped",
  RUN_REPORTS_ALL: "run_reports_all",
  RUN_REPORTS_SCOPED: "run_reports_scoped",
  VIEW_AUDIT: "view_audit",
  MANAGE_ORG: "manage_org",
  MANAGE_TEMPLATES: "manage_templates",
  MANAGE_SETTINGS: "manage_settings",
  CONFIGURE_ENGINE: "configure_engine",
  MANAGE_PHASE2: "manage_phase2",
} as const;

export type PermissionName = (typeof PERM)[keyof typeof PERM];
