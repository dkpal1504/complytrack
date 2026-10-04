import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { qk } from "@/lib/query";
import type { MyWorkDashboard } from "@/types/api";

const EMPTY = { open: 0, overdue: 0, expired: 0, escalated: 0 };

/**
 * The badge counts under "My Work".
 *
 * Every badge in the shell reads from this one query, so the numbers agree
 * with the My Work screen itself and the request is made once, not four times.
 */
export function useMyWorkCounts() {
  const query = useQuery({
    queryKey: qk.dashboards.myWork,
    queryFn: () => api<MyWorkDashboard>("/dashboards/my-work"),
    // Refresh every two minutes: these are the numbers a user leaves on
    // screen while they work, and a stale badge is worse than no badge.
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  return { counts: query.data?.counts ?? EMPTY, isLoading: query.isLoading, query };
}
