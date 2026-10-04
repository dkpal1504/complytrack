/**
 * File downloads for reports and the audit trail.
 *
 * Exports carry the auth header, so they must go through `apiFile` + `saveBlob`
 * rather than a plain link. This hook owns the loading state and the toast so
 * every export button behaves the same way. Pass `fmt: null` for endpoints
 * whose path already fixes the format (the report iCal feed, for example).
 */

import { useCallback, useState } from "react";

import { apiFile, ApiError, saveBlob } from "@/lib/api";
import { useToast } from "@/components/ui/Feedback";

export type DownloadFormat = "csv" | "xlsx" | "pdf";

export function useReportDownload() {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const run = useCallback(
    async (
      path: string,
      query: Record<string, unknown>,
      fmt: DownloadFormat | null,
      what = "Export",
    ) => {
      const key = fmt ?? path;
      setPending(key);
      try {
        const { blob, filename } = await apiFile(path, {
          query: fmt ? { ...query, fmt } : query,
        });
        saveBlob(blob, filename);
        toast.success(`${what} ready`, filename);
      } catch (error) {
        const detail =
          error instanceof ApiError ? error.detail : "The download could not be prepared.";
        toast.error(`${what} failed`, detail);
      } finally {
        setPending(null);
      }
    },
    [toast],
  );

  return { run, pending };
}
