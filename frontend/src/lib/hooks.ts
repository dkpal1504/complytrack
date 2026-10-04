/** Small shared hooks used across the screens. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** Delays a rapidly changing value — used to keep search from firing per keystroke. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Tracks a CSS media query, for the few places that must branch in JavaScript. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery("(max-width: 767px)");

/**
 * Filter state kept in the URL.
 *
 * A compliance officer who filters the register to "Expired, Main Shipyard,
 * Critical" must be able to send that link to a colleague, and to press Back
 * without losing it. Every filter therefore lives in the query string.
 */
export function useUrlFilters<T extends Record<string, unknown>>(defaults: T) {
  const [params, setParams] = useSearchParams();

  // `defaults` is a literal defined by the caller, so its identity changes on
  // every render. Its serialised form does not, and a string is compared by
  // value — that is what keeps the parse below from running every render.
  const defaultsKey = JSON.stringify(defaults);

  const filters = useMemo(() => {
    const parsed: Record<string, unknown> = { ...defaults };
    for (const [key, fallback] of Object.entries(defaults)) {
      const raw = params.get(key);
      if (raw === null) continue;
      if (typeof fallback === "number") parsed[key] = Number(raw) || fallback;
      else if (typeof fallback === "boolean") parsed[key] = raw === "true";
      else parsed[key] = raw;
    }
    return parsed as T;
  }, [params, defaultsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = useCallback(
    (key: keyof T, value: unknown) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          const isDefault = value === defaults[key];
          if (value === undefined || value === null || value === "" || isDefault) {
            next.delete(String(key));
          } else {
            next.set(String(key), String(value));
          }
          // Any filter change invalidates the page number.
          if (key !== "page") next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [defaults, setParams],
  );

  const setFilters = useCallback(
    (patch: Partial<T>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === null || value === "" || value === defaults[key]) {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [defaults, setParams],
  );

  const reset = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  const activeCount = useMemo(
    () =>
      Object.entries(defaults).filter(([key, fallback]) => {
        if (key === "page" || key === "page_size" || key === "sort") return false;
        const raw = params.get(key);
        return raw !== null && raw !== String(fallback);
      }).length,
    [defaults, params],
  );

  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("page_size") ?? 50) || 50;
  const setPage = useCallback(
    (next: number) =>
      setParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next <= 1) params.delete("page");
          else params.set("page", String(next));
          return params;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setPageSize = useCallback(
    (next: number) =>
      setParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.delete("page");
          if (next === 50) params.delete("page_size");
          else params.set("page_size", String(next));
          return params;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { filters, setFilter, setFilters, reset, activeCount, page, pageSize, setPage, setPageSize, params };
}

/** Calls `handler` on a timer, and stops when the component unmounts. */
export function useInterval(handler: () => void, delayMs: number | null) {
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  }, [handler]);
  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}

/** Locks body scroll while a sheet is open (used with the Drawer). */
export function useScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}

/** Copies text and reports success, with a fallback for older browsers. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
