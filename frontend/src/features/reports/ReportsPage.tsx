/**
 * Reports hub — the catalogue of the twelve standard reports (R1-R12) plus
 * scheduled email deliveries (RP-01..RP-11, RP-10).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardFooter } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ErrorState, EmptyState, SkeletonCards, useToast } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { PageHeader, SectionTitle } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, titleCase, truncate } from "@/lib/format";
import { qk } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import type { ScheduledReport } from "@/types/api";
import type { ReportCatalogueEntry } from "@/features/reports/report-types";
import { ReportExportButtons } from "@/features/reports/ReportExportButtons";
import { ScheduleDialog } from "@/features/reports/ScheduleDialog";

function ReportCard({ entry }: { entry: ReportCatalogueEntry }) {
  return (
    <Card className="flex h-full flex-col">
      <CardBody className="flex flex-1 flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <Chip icon="report" className="mt-0.5 shrink-0 border-brand-200 bg-brand-50 text-brand-700">
            {entry.code}
          </Chip>
          <h3 className="text-sm leading-snug font-semibold text-ink">{entry.name}</h3>
        </div>
        <p className="text-sm text-ink-muted">{entry.description}</p>
        <div className="mt-auto">
          <p className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">Columns</p>
          <p className="mt-1 text-2xs leading-relaxed text-ink-muted">
            {entry.columns.join(" · ")}
          </p>
        </div>
      </CardBody>
      <CardFooter className="justify-between gap-2">
        <ButtonLink to={`/reports/${entry.code}`} variant="primary" size="sm" icon="arrow-right">
          View
        </ButtonLink>
        <ReportExportButtons code={entry.code} reportName={entry.name} size="sm" />
      </CardFooter>
    </Card>
  );
}

function SchedulesTable({
  schedules,
  onDelete,
  deletingId,
}: {
  schedules: ScheduledReport[];
  onDelete: (schedule: ScheduledReport) => void;
  deletingId: string | null;
}) {
  const columns: Column<ScheduledReport>[] = [
    {
      key: "report",
      header: "Report",
      isTitle: true,
      mobileLabel: "Report",
      cell: (schedule) => (
        <span>
          <span className="font-medium text-ink">{schedule.name}</span>
          <span className="mt-0.5 block text-2xs text-ink-subtle">{schedule.report_code}</span>
        </span>
      ),
    },
    {
      key: "frequency",
      header: "Frequency",
      cell: (schedule) => titleCase(schedule.frequency),
    },
    { key: "format", header: "Format", cell: (schedule) => schedule.format.toUpperCase() },
    {
      key: "recipients",
      header: "Recipients",
      hideBelow: "lg",
      mobileLabel: "Recipients",
      cell: (schedule) => {
        const list = schedule.recipients.join(", ");
        return (
          <span title={list} className="text-ink-muted">
            {truncate(list || "—", 48)}
          </span>
        );
      },
    },
    {
      key: "active",
      header: "Status",
      cell: (schedule) =>
        schedule.active ? (
          <Chip icon="check" className="border-rag-green-border bg-rag-green-bg text-rag-green">
            Active
          </Chip>
        ) : (
          <Chip icon="pause">Stopped</Chip>
        ),
    },
    {
      key: "next_run",
      header: "Next run",
      hideBelow: "xl",
      mobileLabel: "Next run",
      cell: (schedule) =>
        schedule.next_run_at ? (
          <span className="tabular">{formatDateTime(schedule.next_run_at)}</span>
        ) : (
          <span className="text-ink-subtle">Not scheduled</span>
        ),
    },
    {
      key: "last_run",
      header: "Last run",
      hideBelow: "xl",
      mobileLabel: "Last run",
      cell: (schedule) =>
        schedule.last_run_at ? (
          <span className="tabular">{formatDateTime(schedule.last_run_at)}</span>
        ) : (
          <span className="text-ink-subtle">Never</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobileLabel: "Manage",
      cell: (schedule) =>
        schedule.active ? (
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            loading={deletingId === schedule.id}
            onClick={() => onDelete(schedule)}
            aria-label={`Stop scheduled delivery ${schedule.name}`}
            title="Stop this delivery"
          >
            Stop
          </Button>
        ) : (
          <span className="text-2xs text-ink-subtle">Removed</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={schedules}
      getRowId={(schedule) => schedule.id}
      caption="Scheduled report deliveries"
    />
  );
}

export default function ReportsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canConfigure = can(PERM.CONFIGURE_ENGINE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScheduledReport | null>(null);

  const catalogue = useQuery({
    queryKey: qk.reports.catalogue,
    queryFn: () => api<ReportCatalogueEntry[]>("/reports"),
  });

  const schedules = useQuery({
    queryKey: qk.reports.schedules,
    queryFn: () => api<ScheduledReport[]>("/reports/schedules/list"),
    enabled: canConfigure,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api<{ detail: string }>(`/reports/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Scheduled delivery stopped", "The schedule is kept in history as stopped.");
      void queryClient.invalidateQueries({ queryKey: qk.reports.schedules });
      setPendingDelete(null);
    },
    onError: (error) => {
      toast.error(
        "Could not stop the schedule",
        error instanceof ApiError ? error.detail : "Please try again.",
      );
      setPendingDelete(null);
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, ReportCatalogueEntry[]>();
    for (const entry of catalogue.data ?? []) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()];
  }, [catalogue.data]);

  const activeCount = (schedules.data ?? []).filter((schedule) => schedule.active).length;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="The twelve standard statutory reports. View, filter and export any of them, or have one emailed to you on a schedule."
      />

      <div className="space-y-8 px-4 py-5 sm:px-6">
        {catalogue.isPending && <SkeletonCards count={6} />}

        {catalogue.error && (
          <ErrorState error={catalogue.error} onRetry={() => void catalogue.refetch()} />
        )}

        {catalogue.data && groups.length === 0 && (
          <EmptyState
            icon="report"
            title="No reports are configured"
            description="The report catalogue is empty. An administrator can enable the standard reports."
          />
        )}

        {groups.map(([group, entries]) => (
          <section key={group} className="space-y-3">
            <SectionTitle
              title={group}
              count={entries.length}
              description={`${entries.length} report${entries.length === 1 ? "" : "s"} in this group.`}
            />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {entries.map((entry) => (
                <ReportCard key={entry.code} entry={entry} />
              ))}
            </div>
          </section>
        ))}

        {canConfigure && (
          <section className="space-y-3">
            <SectionTitle
              title="Scheduled deliveries"
              count={activeCount}
              description="Recurring report emails delivered by the daily scheduler."
              actions={
                <Button variant="primary" size="sm" icon="plus" onClick={() => setDialogOpen(true)}>
                  New schedule
                </Button>
              }
            />
            <Card>
              {schedules.isPending && <SkeletonCards count={2} className="p-4" />}
              {schedules.error && (
                <div className="p-4">
                  <ErrorState error={schedules.error} onRetry={() => void schedules.refetch()} />
                </div>
              )}
              {schedules.data && schedules.data.length === 0 && (
                <EmptyState
                  icon="mail"
                  title="No scheduled deliveries yet"
                  description="Schedule a report to have it emailed to the compliance team automatically."
                  action={
                    <Button variant="primary" icon="plus" onClick={() => setDialogOpen(true)}>
                      Schedule a report
                    </Button>
                  }
                />
              )}
              {schedules.data && schedules.data.length > 0 && (
                <SchedulesTable
                  schedules={schedules.data}
                  onDelete={setPendingDelete}
                  deletingId={deleteMutation.isPending ? (deleteMutation.variables ?? null) : null}
                />
              )}
            </Card>
          </section>
        )}
      </div>

      <ScheduleDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: qk.reports.schedules })}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
        title="Stop this scheduled delivery?"
        message={
          <>
            <strong>{pendingDelete?.name}</strong> will no longer be emailed. The schedule is kept
            in history marked as stopped; it is not permanently deleted.
          </>
        }
        confirmLabel="Stop delivery"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
