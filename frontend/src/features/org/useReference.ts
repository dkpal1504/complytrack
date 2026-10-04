/**
 * Reference data: the enum catalogue and the master-data lookups.
 *
 * Both are effectively static for the life of a session, so they are cached
 * aggressively and shared by every screen that needs a dropdown. Loading the
 * department list once for the whole app also keeps the register's filter bar
 * from refetching as the user moves between screens.
 */

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { qk } from "@/lib/query";
import type { AppMeta, OrgLookups } from "@/types/api";

export function useMeta() {
  return useQuery({
    queryKey: qk.meta,
    queryFn: () => api<AppMeta>("/meta"),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useLookups(enabled = true) {
  return useQuery({
    queryKey: qk.org.lookups,
    queryFn: () => api<OrgLookups>("/org/lookups"),
    staleTime: 10 * 60_000,
    enabled,
  });
}

/** Turns a lookup list into `{value, label}` options for a `<Select>`. */
export function toOptions(
  items: { id: string; name: string; code?: string | null }[] | undefined,
  { withCode = false, allLabel }: { withCode?: boolean; allLabel?: string } = {},
) {
  const options = (items ?? []).map((item) => ({
    value: item.id,
    label: withCode && item.code ? `${item.name} (${item.code})` : item.name,
  }));
  return allLabel ? [{ value: "", label: allLabel }, ...options] : options;
}

/** Turns a plain string list into options. */
export function stringsToOptions(values: string[] | undefined, allLabel?: string) {
  const options = (values ?? []).map((value) => ({ value, label: value }));
  return allLabel ? [{ value: "", label: allLabel }, ...options] : options;
}
