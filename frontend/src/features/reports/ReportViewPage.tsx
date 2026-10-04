/**
 * One standard report, rendered from its live payload (RP-01..RP-11).
 *
 * The header carries the exports, the Outlook subscription, the schedule
 * action and Print; the filter bar maps onto the endpoint's real parameters and
 * lives in the URL, so a filtered view is a shareable link.
 */

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/Feedback";
import { Breadcrumbs } from "@/components/ui/Nav";
import { PageHeader, ResultCount, StatTile } from "@/components/ui/Page";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useUrlFilters } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import type { ReportResultLive } from "@/features/reports/report-types";
import { EMPTY_REPORT_FILTERS, ReportFilters, type ReportFilterValues } from "@/features/reports/ReportFilters";
import { ReportExportButtons } from "@/features/reports/ReportExportButtons";
import { ReportTable } from "@/features/reports/ReportTable";
import { ScheduleDialog } from "@/features/reports/ScheduleDialog";
import { summaryTiles } from "@/features/reports/report-utils";
import { useReportDownload } from "@/features/reports/useReportDownload";

function tileTone(label: string): "neutral" | "good" | "warning" | "critical" {
  const value = label.toLowerCase();
  if (/(expired|overdue|broken|failed)/.test(value)) return "critical";
  if (/(pending|under process|escalation|due soon)/.test(value)) return "warning";
  if (/(complied|on time|completed|received|intact)/.test(value)) return "good";
  return "neutral";
}

export default function ReportViewPage() {
  const { code = "" } = useParams();
  const { can } = useAuth();
  const canConfigure = can(PERM.CONFIGURE_ENGINE);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const { filters, setFilter, reset, activeCount } = useUrlFilters<ReportFilterValues>(
    EMPTY_REPORT_FILTERS,
  );

  const report = useQuery({
    queryKey: qk.reports.result(code, filters),
    queryFn: () => api<ReportResultLive>(`/reports/${code}`, { query: filters }),
    enabled: Boolean(code),
  });

  const { run, pending } = useReportDownload();

  const data = report.data;
  const tiles = data ? summaryTiles(data) : [];
  const rowCount = data?.rows.length ?? 0;
  const summaryTotal = Number((data?.summary as { total?: unknown } | undefined)?.total);
  const totalForCount = Number.isFinite(summaryTotal) ? summaryTotal : rowCount;

  const subscribe = () =>
    void run(`/reports/${code}/ical`, {}, null, "Calendar subscription");

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Reports", to: "/reports" }, { label: data?.name ?? code }]}
          />
        }
        title={data ? `${code} · ${data.name}` : `Report ${code}`}
        description={
          data
            ? `Generated ${formatDateTime(data.generated_at)}. Filters apply to the table and to every export.`
            : undefined
        }
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <ButtonLink to="/reports" size="sm" icon="arrow-left">
              Back to catalogue
            </ButtonLink>
            <ReportExportButtons code={code} reportName={data?.name} query={filters} size="sm" />
            <Button
              size="sm"
              icon="calendar-clock"
              loading={pending === `/reports/${code}/ical`}
              onClick={subscribe}
              title="Add the renewal dates from this report to your Outlook calendar"
            >
              Subscribe in Outlook
            </Button>
            {canConfigure && (
              <Button size="sm" icon="mail-check" onClick={() => setScheduleOpen(true)}>
                Schedule
              </Button>
            )}
            <Button size="sm" icon="print" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-4 py-5 sm:px-6">
        {report.error && (
          <ErrorState error={report.error} onRetry={() => void report.refetch()} />
        )}

        {tiles.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {tiles.map((tile) => (
              <StatTile key={tile.label} label={tile.label} value={tile.value} tone={tileTone(tile.label)} />
            ))}
          </div>
        )}

        {(report.isPending || data) && (
          <Card>
            <ReportFilters
              values={filters}
              onChange={setFilter}
              onReset={reset}
              activeCount={activeCount}
            />

            {report.isPending && <SkeletonRows rows={8} className="p-4" />}

            {data && rowCount === 0 && (
              <EmptyState
                icon="search"
                title="No rows match these filters"
                description="This report ran successfully but the current unit, department, category and date filters returned nothing. Widen or clear the filters to see more."
                action={
                  activeCount > 0 ? (
                    <Button icon="x" onClick={reset}>
                      Clear filters
                    </Button>
                  ) : (
                    <ButtonLink to="/reports" icon="arrow-left">
                      Back to the catalogue
                    </ButtonLink>
                  )
                }
              />
            )}

            {data && rowCount > 0 && (
              <>
                <ReportTable result={data} />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-5">
                  <ResultCount shown={rowCount} total={totalForCount} noun="row" />
                  <p className="text-2xs text-ink-subtle" role="status">
                    Generated {formatDateTime(data.generated_at)}
                  </p>
                </div>
              </>
            )}
          </Card>
        )}
      </div>

      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        reportCode={code}
        reportName={data?.name}
        defaultName={data ? `${data.name} (scheduled)` : undefined}
        filters={filters}
      />
    </div>
  );
}
