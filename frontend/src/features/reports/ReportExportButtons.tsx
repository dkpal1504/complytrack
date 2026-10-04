/**
 * CSV / XLSX / PDF export buttons for a report.
 *
 * The API names the query parameter `fmt` (not `format`), and the export
 * carries the auth token, so it goes through the download hook.
 */

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useReportDownload, type DownloadFormat } from "@/features/reports/useReportDownload";

const FORMATS: { fmt: DownloadFormat; label: string }[] = [
  { fmt: "csv", label: "CSV" },
  { fmt: "xlsx", label: "XLSX" },
  { fmt: "pdf", label: "PDF" },
];

export function ReportExportButtons({
  code,
  reportName,
  query,
  size = "sm",
  block = false,
  className,
}: {
  code: string;
  reportName?: string;
  query?: Record<string, unknown>;
  size?: "sm" | "md";
  block?: boolean;
  className?: string;
}) {
  const { run, pending } = useReportDownload();

  return (
    <div className={cn("flex flex-wrap gap-1.5", block && "w-full", className)}>
      {FORMATS.map(({ fmt, label }) => (
        <Button
          key={fmt}
          size={size}
          variant="secondary"
          block={block}
          loading={pending === fmt}
          disabled={pending !== null && pending !== fmt}
          onClick={() => void run(`/reports/${code}/export`, query ?? {}, fmt, "Report export")}
          aria-label={`Export ${reportName ?? code} as ${label}`}
          title={`Download as ${label}`}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
