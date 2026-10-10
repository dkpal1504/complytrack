/**
 * One TanStack Query client for the app, plus the query-key conventions.
 *
 * Keeping the keys in one place is what makes invalidation reliable: after a
 * workflow transition the register, the dashboards and the reports all need
 * to refresh, and they only do that if they agree on the key prefixes.
 */

import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Compliance data changes on a human timescale, not a millisecond one.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Never retry a permission error or a missing record — retrying
        // cannot change the answer, and it hides the message from the user.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/** `qk.items.list(filters)` — a stable, serialisable identity for a query. */
export const qk = {
  meta: ["meta"] as const,
  me: ["me"] as const,

  items: {
    all: ["items"] as const,
    list: (filters: unknown) => ["items", "list", filters] as const,
    detail: (id: string) => ["items", "detail", id] as const,
    savedViews: ["items", "saved-views"] as const,
    statusOptions: ["items", "status-options"] as const,
  },

  instances: {
    detail: (id: string) => ["instances", "detail", id] as const,
    timeline: (id: string) => ["instances", "timeline", id] as const,
  },

  documents: {
    list: (filters: unknown) => ["documents", "list", filters] as const,
    shareLinks: (documentId: string) => ["documents", documentId, "share-links"] as const,
  },

  dashboards: {
    management: (filters: unknown) => ["dashboards", "management", filters] as const,
    officer: (filters: unknown) => ["dashboards", "officer", filters] as const,
    myWork: ["dashboards", "my-work"] as const,
    calendar: (filters: unknown) => ["dashboards", "calendar", filters] as const,
    filters: ["dashboards", "filters"] as const,
  },

  reports: {
    catalogue: ["reports", "catalogue"] as const,
    result: (code: string, filters: unknown) => ["reports", code, filters] as const,
    schedules: ["reports", "schedules"] as const,
  },

  notifications: {
    list: (filters: unknown) => ["notifications", filters] as const,
  },

  audit: {
    list: (filters: unknown) => ["audit", "list", filters] as const,
    facets: ["audit", "facets"] as const,
    verify: ["audit", "verify"] as const,
  },

  reminders: {
    profiles: ["reminders", "profiles"] as const,
    matrix: ["reminders", "matrix"] as const,
    log: (filters: unknown) => ["reminders", "log", filters] as const,
    escalationLog: (filters: unknown) => ["reminders", "escalation-log", filters] as const,
    jobs: ["reminders", "jobs"] as const,
    templates: ["reminders", "templates"] as const,
    outbox: ["reminders", "outbox"] as const,
    // Nested under ``outbox`` so refreshing the listing also refreshes any
    // message currently open in the preview.
    outboxMessage: (name: string) => ["reminders", "outbox", name] as const,
    mail: ["reminders", "mail"] as const,
  },

  org: {
    lookups: ["org", "lookups"] as const,
    units: ["org", "units"] as const,
    departments: ["org", "departments"] as const,
    categories: ["org", "categories"] as const,
    authorities: ["org", "authorities"] as const,
    legalReferences: ["org", "legal-references"] as const,
    holidays: ["org", "holidays"] as const,
    settings: ["org", "settings"] as const,
  },

  templates: {
    list: (filters: unknown) => ["templates", "list", filters] as const,
    detail: (id: string) => ["templates", "detail", id] as const,
    tree: ["templates", "tree"] as const,
  },

  users: {
    list: (filters: unknown) => ["users", "list", filters] as const,
    accessReview: ["users", "access-review"] as const,
    orphans: ["users", "orphans"] as const,
  },
} as const;

/**
 * Invalidate everything that a change to the register could have moved.
 *
 * A single transition can change a dashboard figure, a report and a
 * notification badge at once, so they are refreshed together rather than
 * leaving the screen quietly stale.
 */
export function invalidateRegister(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["items"] });
  void queryClient.invalidateQueries({ queryKey: ["instances"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
  void queryClient.invalidateQueries({ queryKey: ["reports"] });
  void queryClient.invalidateQueries({ queryKey: ["notifications"] });
}

/** Refresh the audit trail and reminder surfaces after an administrative act. */
export function invalidateAdmin(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["audit"] });
  void queryClient.invalidateQueries({ queryKey: ["reminders"] });
  void queryClient.invalidateQueries({ queryKey: ["users"] });
  void queryClient.invalidateQueries({ queryKey: ["org"] });
}
