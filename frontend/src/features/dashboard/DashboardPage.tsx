/**
 * The management dashboard (PRD §7.1, screen 2).
 *
 * The KPI numbers carry the message; the charts are a second reading of the
 * same figures for anyone who can use colour and shape. Every chart therefore
 * ships with a text legend and a screen-reader summary, and never relies on
 * colour alone.
 */

import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CriticalityChip, RagDot } from "@/components/ui/Chip";
import { EscalationChip } from "@/components/ui/EscalationChip";
import { EmptyState, ErrorState, SkeletonCards, SkeletonRows, useToast } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Form";
import { PageHeader, SectionTitle, StatTile, Toolbar } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { stringsToOptions, toOptions, useLookups } from "@/features/org/useReference";
import { ApiError, api, apiFile, saveBlob } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatCountdown, formatDate, formatDateTime, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { useUrlFilters } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { BUCKET_STYLES, CHART_SERIES, indexRag } from "@/lib/status";
import type { ChartDatum, ComplianceBucket, Criticality, OfficerRow, StackedDatum } from "@/types/api";

/* The endpoint returns a little more than the shared type declares: the KPI
   list uses the API's own severity words, and the risk/escalation roll-ups are
   not in `ManagementDashboard`. They are typed here so the screen stays honest
   about what it reads. */
interface MgmtKpi {
  key: string;
  label: string;
  value: number;
  suffix?: string;
  severity?: string;
  drill?: string | null;
}

interface TopRisk {
  item_id: string;
  item_code: string;
  name: string;
  unit: string | null;
  owner: string | null;
  criticality: Criticality;
  status: string | null;
  days_overdue: number | null;
  days_left: number | null;
  expiry_date: string | null;
  exposure: number | null;
}

interface ActiveEscalation {
  instance_id: string | null;
  item_id: string;
  item_name: string;
  level: number;
  label: string;
  since: string;
  owner: string | null;
  unit: string | null;
  criticality: Criticality;
}

interface MgmtDashboard {
  generated_at: string;
  filters: Record<string, unknown>;
  kpis: MgmtKpi[];
  status_split: ChartDatum[];
  department_status: StackedDatum[];
  unit_status: StackedDatum[];
  category_status: ChartDatum[];
  renewal_timeline: StackedDatum[];
  index_trend: { label: string; value: number }[];
  top_risks?: TopRisk[];
  escalations?: ActiveEscalation[];
  fees_next_quarter?: number;
  expiring_soon?: OfficerRow[];
  compliance_index?: {
    index: number;
    counted: number;
    complied: number;
    total_weight: number;
    complied_weight: number;
  };
}

const TOOLTIP_STYLE = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--color-ink)",
} as const;

function bucketColor(key: string | undefined): string {
  const bucket = key as ComplianceBucket | undefined;
  return (bucket && BUCKET_STYLES[bucket]?.solid) || "var(--color-rag-grey)";
}

/** A chart with its legend and its screen-reader summary in one frame. */
function ChartFrame({
  title,
  description,
  summary,
  legend,
  children,
}: {
  title: string;
  description?: string;
  summary: string;
  legend: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={title} description={description} />
      <CardBody className="flex flex-1 flex-col">
        {/* Recharts renders an SVG that a screen reader cannot read; the summary
            below carries the same information as text, and the legend beside it
            carries the numbers as real text too. So the plot is hidden from
            assistive technology — and therefore must not be reachable by
            keyboard either: a focusable element inside an `aria-hidden` subtree
            is announced as nothing, which strands a keyboard user on a stop they
            cannot hear. Each chart below is given `accessibilityLayer={false}`
            for that reason; Recharts otherwise puts `tabindex="0"` on its own
            surface. */}
        <div className="h-64 shrink-0" aria-hidden="true">
          {children}
        </div>
        <div className="mt-3">{legend}</div>
        <p className="sr-only">{summary}</p>
      </CardBody>
    </Card>
  );
}

function ChartLegend({
  items,
}: {
  items: { label: string; color: string; value?: number; percent?: string }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-ink">{item.label}</span>
          {item.value !== undefined && (
            <span className="tabular text-ink-subtle">
              {formatNumber(item.value)}
              {item.percent ? ` (${item.percent})` : ""}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The 5-bucket legend the donut and both stacked bars share. */
function bucketLegend(counts?: Record<string, number>) {
  return CHART_SERIES.map((series) => ({
    label: series.key,
    color: series.color,
    value: counts?.[series.key],
  }));
}

export default function DashboardPage() {
  const toast = useToast();
  const lookups = useLookups();

  const { filters, setFilter, reset, activeCount } = useUrlFilters({
    unit_id: "",
    department_id: "",
    category_id: "",
    criticality: "",
  });

  const query = useQuery({
    queryKey: qk.dashboards.management(filters),
    queryFn: () => api<MgmtDashboard>("/dashboards/management", { query: filters }),
  });

  const exportIcal = useMutation({
    mutationFn: () => apiFile("/dashboards/export/ical"),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename);
      toast.success(
        "Calendar exported",
        "Open the .ics file to subscribe from Outlook, Google Calendar or Apple Calendar.",
      );
    },
    onError: (error) => {
      toast.error(
        "Could not export the calendar",
        error instanceof ApiError ? error.detail : "Please try again.",
      );
    },
  });

  const data = query.data;
  const kpi = (key: string) => data?.kpis.find((entry) => entry.key === key);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const slice of data?.status_split ?? []) counts[slice.key ?? slice.label] = slice.value;
    return counts;
  }, [data?.status_split]);

  const expiringRows = useMemo<ExpiringRow[]>(() => {
    if (!data) return [];
    if (data.expiring_soon?.length) {
      return data.expiring_soon.map((row) => ({
        item_id: row.item_id,
        item_code: row.item_code,
        name: row.name,
        unit: row.unit,
        owner: row.owner,
        criticality: row.criticality,
        days_left: row.days_left,
        expiry_date: row.expiry_date,
        escalation_level: row.escalation_level,
      }));
    }
    // The live endpoint reports its actionable set as `top_risks` rather than
    // `expiring_soon`; anything due within 30 days (or already overdue) is the
    // same "expiring soon" queue from a manager's point of view.
    return (data.top_risks ?? [])
      .filter((row) => row.days_left === null || row.days_left <= 30)
      .map((row) => ({
        item_id: row.item_id,
        item_code: row.item_code,
        name: row.name,
        unit: row.unit,
        owner: row.owner,
        criticality: row.criticality,
        days_left: row.days_left,
        expiry_date: row.expiry_date,
        escalation_level: 0,
      }));
  }, [data]);

  const indexValue = Number(kpi("index")?.value ?? 0);
  const totalValue = Number(kpi("total")?.value ?? 0);
  const compliedValue = Number(kpi("complied")?.value ?? 0);
  const escalatedCount = data?.escalations?.length ?? 0;

  /**
   * Where a KPI card drills to (PRD §7, AC-5).
   *
   * The card's own `drill` code goes to the register as its `bucket` filter —
   * the server counts the card and filters the list with one shared rule, so
   * the two can only agree. The dashboard's active filters ride along, because
   * a number read under a unit filter is a different question from the whole
   * estate, and the list behind the card must answer the one that was asked.
   */
  const drillHref = (key: string): string | undefined => {
    const drill = kpi(key)?.drill;
    if (!drill) return undefined;
    const params = new URLSearchParams();
    const carried = ["unit_id", "department_id", "category_id", "criticality"] as const;
    for (const name of carried) {
      const value = filters[name];
      if (value) params.set(name, value);
    }
    params.set("bucket", drill);
    return `/register?${params.toString()}`;
  };

  if (query.isPending) {
    return (
      <div>
        <PageHeader title="Management dashboard" description="Loading the compliance position…" />
        <div className="px-4 py-4 sm:px-6">
          <SkeletonCards count={4} />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <SkeletonRows rows={4} />
            <SkeletonRows rows={4} />
          </div>
        </div>
      </div>
    );
  }

  if (query.error) {
    return (
      <div>
        <PageHeader title="Management dashboard" />
        <ErrorState error={query.error} onRetry={() => query.refetch()} className="py-24" />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PageHeader title="Management dashboard" />
        <EmptyState
          icon="gauge"
          title="Nothing to report yet"
          description="Once obligations are added to the register, this dashboard will show the compliance position."
          className="py-24"
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Management dashboard"
        description={
          <>
            The compliance position across every unit, as at {formatDateTime(data.generated_at)}.
          </>
        }
        actions={
          <Button
            icon="download"
            onClick={() => exportIcal.mutate()}
            loading={exportIcal.isPending}
          >
            Export iCal
          </Button>
        }
      />

      {/* ------------------------------- Filters ------------------------------- */}
      <Toolbar label="Dashboard filters">
        <Select
          aria-label="Unit"
          className="sm:w-44"
          value={String(filters.unit_id ?? "")}
          onChange={(event) => setFilter("unit_id", event.target.value)}
          options={toOptions(lookups.data?.units, { allLabel: "All units" })}
        />
        <Select
          aria-label="Department"
          className="sm:w-52"
          value={String(filters.department_id ?? "")}
          onChange={(event) => setFilter("department_id", event.target.value)}
          options={toOptions(lookups.data?.departments, { allLabel: "All departments" })}
        />
        <Select
          aria-label="Category"
          className="sm:w-52"
          value={String(filters.category_id ?? "")}
          onChange={(event) => setFilter("category_id", event.target.value)}
          options={toOptions(lookups.data?.categories, { allLabel: "All categories" })}
        />
        <Select
          aria-label="Criticality"
          className="sm:w-44"
          value={String(filters.criticality ?? "")}
          onChange={(event) => setFilter("criticality", event.target.value)}
          options={stringsToOptions(lookups.data?.criticalities, "All criticalities")}
        />
        {activeCount > 0 && (
          <Button variant="ghost" icon="x" onClick={reset}>
            Clear filters
          </Button>
        )}
      </Toolbar>

      <div className="space-y-6 px-4 py-4 sm:px-6 sm:py-5">
        {/* -------------------------------- KPIs -------------------------------- */}
        <section aria-label="Key figures">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Total active obligations"
              value={formatNumber(totalValue)}
              icon="list"
              tone="neutral"
              hint={`${formatNumber(compliedValue)} complied`}
              href={drillHref("total")}
            />
            <StatTile
              label="Compliance Index"
              value={formatPercent(indexValue)}
              icon="gauge"
              tone={
                indexRag(indexValue) === "green"
                  ? "good"
                  : indexRag(indexValue) === "amber"
                    ? "warning"
                    : "critical"
              }
              hint={
                data.compliance_index
                  ? `${formatNumber(data.compliance_index.complied)} of ${formatNumber(
                      data.compliance_index.counted,
                    )} complied · criticality-weighted`
                  : `${formatNumber(compliedValue)} of ${formatNumber(totalValue)} complied · criticality-weighted`
              }
              href={drillHref("index")}
            />
            <StatTile
              label="Expired"
              value={formatNumber(Number(kpi("expired")?.value ?? 0))}
              icon="x-circle"
              tone="critical"
              hint="licences or certificates past expiry"
              href={drillHref("expired")}
            />
            <StatTile
              label="Overdue"
              value={formatNumber(Number(kpi("overdue")?.value ?? 0))}
              icon="alert"
              tone="critical"
              hint="past the renewal due date"
              href={drillHref("overdue")}
            />
            <StatTile
              label="Due in next 30 days"
              value={formatNumber(Number(kpi("due_30")?.value ?? 0))}
              icon="calendar-clock"
              tone="warning"
              hint="renewals to start now"
              href={drillHref("due_30")}
            />
            {/* No drill: the figure is a capped roll-up ("15+" means at least
                fifteen), so there is no list whose length equals it. */}
            <StatTile
              label="Escalated"
              value={
                escalatedCount >= 15 ? "15+" : formatNumber(escalatedCount)
              }
              icon="arrow-up-right"
              tone={escalatedCount > 0 ? "critical" : "neutral"}
              hint="at level 2 or above"
            />
            <StatTile
              label="In flight"
              value={formatNumber(Number(kpi("under_process")?.value ?? 0))}
              icon="progress"
              tone="brand"
              hint="under process or submitted"
              href={drillHref("under_process")}
            />
            <StatTile
              label="Renewal fees due"
              value={formatMoney(data.fees_next_quarter ?? null)}
              icon="spreadsheet"
              tone="neutral"
              hint="in the next quarter"
            />
          </div>
        </section>

        {/* ------------------------------- Charts ------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartFrame
            title="Status split"
            description="How every active obligation counts today."
            summary={`Status split: ${data.status_split
              .map((slice) => `${slice.value} ${slice.label}`)
              .join(", ")}.`}
            legend={<ChartLegend items={bucketLegend(statusCounts)} />}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer={false}>
                <Pie
                  // The whole plot is `aria-hidden` (see ChartFrame). Recharts
                  // makes its own layer tabbable by default, which would leave a
                  // keyboard stop on an element with no announced name at all.
                  rootTabIndex={-1}
                  data={data.status_split}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="55%"
                  outerRadius="82%"
                  paddingAngle={2}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                >
                  {data.status_split.map((slice) => (
                    <Cell key={slice.label} fill={bucketColor(slice.key ?? slice.label)} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </ChartFrame>

          <ChartFrame
            title="Compliance Index trend"
            description="The criticality-weighted index over the last twelve months."
            summary={`Compliance Index trend from ${data.index_trend[0]?.label ?? "—"} to ${
              data.index_trend[data.index_trend.length - 1]?.label ?? "—"
            }, currently ${formatPercent(indexValue)}.`}
            legend={
              <ChartLegend
                items={[
                  { label: "Compliance Index", color: "var(--color-brand-600)", value: indexValue },
                ]}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                accessibilityLayer={false}
                data={data.index_trend}
                margin={{ top: 8, right: 8, bottom: 4, left: -12 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--color-ink-muted)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-line)" }}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tick={{ fontSize: 11, fill: "var(--color-ink-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${value}%`, "Index"]} />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Index"
                  stroke="var(--color-brand-600)"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "var(--color-brand-600)" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>

          <StackedBarFrame
            title="Unit-wise status"
            description="Every obligation in each unit, by status."
            data={data.unit_status}
            summaryPrefix="Unit-wise status"
          />
          <StackedBarFrame
            title="Department-wise status"
            description="Every obligation in each department, by status."
            data={data.department_status}
            summaryPrefix="Department-wise status"
          />

          <StackedBarFrame
            title="Renewals by month"
            description="What falls due in each of the next twelve months."
            data={data.renewal_timeline}
            summaryPrefix="Renewals by month"
            className="lg:col-span-2"
          />
        </div>

        {/* --------------------------- Expiring soon --------------------------- */}
        <section>
          <SectionTitle
            title="Expiring soon"
            count={expiringRows.length}
            description="Expired, overdue or due within the next 30 days — act on these first."
          />
          <Card>
            <DataTable<ExpiringRow>
              caption="Obligations that are expired, overdue or due within 30 days"
              rows={expiringRows}
              getRowId={(row) => row.item_id}
              rowHref={(row) => `/items/${row.item_id}`}
              rowTone={(row) => (row.days_left !== null && row.days_left < 0 ? "danger" : "warning")}
              columns={EXPIRING_COLUMNS}
              empty={
                <EmptyState
                  icon="check-circle"
                  title="Nothing expiring in the next 30 days"
                  description="Every obligation in scope is either complied or falls due further out."
                />
              }
            />
          </Card>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stacked bars                                                                */
/* -------------------------------------------------------------------------- */

function stackedSummary(prefix: string, data: StackedDatum[]): string {
  if (!data.length) return `${prefix}: no obligations in scope.`;
  const parts = data.map((row) => {
    const buckets = CHART_SERIES.filter((series) => (row.values[series.key] ?? 0) > 0)
      .map((series) => `${row.values[series.key]} ${series.key}`)
      .join(", ");
    return `${row.category}: ${buckets || "none"}`;
  });
  return `${prefix}. ${parts.join(". ")}.`;
}

function StackedBarFrame({
  title,
  description,
  data,
  summaryPrefix,
  className,
}: {
  title: string;
  description: string;
  data: StackedDatum[];
  summaryPrefix: string;
  className?: string;
}) {
  const totals: Record<string, number> = {};
  for (const row of data) {
    for (const series of CHART_SERIES) {
      totals[series.key] = (totals[series.key] ?? 0) + (row.values[series.key] ?? 0);
    }
  }

  if (!data.length) {
    return (
      <Card className={cn("flex h-full flex-col", className)}>
        <CardHeader title={title} description={description} />
        <CardBody>
          <EmptyState
            icon="filter"
            title="No obligations in scope"
            description="Widen the filters above to bring this breakdown back."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className={className}>
      <ChartFrame
        title={title}
        description={description}
        summary={stackedSummary(summaryPrefix, data)}
        legend={<ChartLegend items={bucketLegend(totals)} />}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer={false}
            data={data}
            margin={{ top: 8, right: 8, bottom: 48, left: -12 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
            <XAxis
              dataKey="category"
              tick={{ fontSize: 11, fill: "var(--color-ink-muted)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-line)" }}
              angle={-25}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "var(--color-ink-muted)" }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            {CHART_SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={`values.${series.key}`}
                name={series.key}
                stackId="status"
                fill={series.color}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Expiring-soon table                                                         */
/* -------------------------------------------------------------------------- */

interface ExpiringRow {
  item_id: string;
  item_code: string;
  name: string;
  unit: string | null;
  owner: string | null;
  criticality: Criticality;
  days_left: number | null;
  expiry_date: string | null;
  escalation_level: number;
}

const EXPIRING_COLUMNS: Column<ExpiringRow>[] = [
  {
    key: "name",
    header: "Obligation",
    isTitle: true,
    cell: (row) => (
      <span>
        <span className="block font-medium text-ink">{row.name}</span>
        <span className="block text-2xs text-ink-subtle">{row.item_code}</span>
      </span>
    ),
  },
  {
    key: "unit",
    header: "Unit",
    mobileLabel: "Unit",
    hideBelow: "lg",
    cell: (row) => row.unit ?? "—",
  },
  {
    key: "criticality",
    header: "Criticality",
    mobileLabel: "Criticality",
    cell: (row) => <CriticalityChip criticality={row.criticality} />,
  },
  {
    key: "status",
    header: "Timing",
    mobileLabel: "Timing",
    cell: (row) => (
      <span className="inline-flex items-center gap-1.5">
        <RagDot rag={row.days_left !== null && row.days_left < 0 ? "red" : "amber"} />
        <span>{formatCountdown(row.days_left)}</span>
      </span>
    ),
  },
  {
    key: "expiry",
    header: "Expiry date",
    mobileLabel: "Expires",
    hideBelow: "sm",
    cell: (row) => <span className="tabular">{formatDate(row.expiry_date)}</span>,
  },
  {
    key: "owner",
    header: "Owner",
    mobileLabel: "Owner",
    hideBelow: "xl",
    cell: (row) => row.owner ?? "Unassigned",
  },
  {
    key: "escalation",
    header: "Escalation",
    mobileLabel: "Escalation",
    hideBelow: "xl",
    cell: (row) => <EscalationChip level={row.escalation_level} />,
  },
];
