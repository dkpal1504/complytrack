/**
 * The renewal calendar (PRD §7.4, screen 5).
 *
 * Twelve months of due dates, expiries and internal targets on one grid, with
 * the worst status on any given day carrying the cell colour. On a phone the
 * grid still fits — seven narrow columns of numbers — and tapping a day opens
 * the day's list as a bottom sheet rather than pushing the grid off screen.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Chip, CriticalityChip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { SegmentedControl } from "@/components/ui/Nav";
import { Modal } from "@/components/ui/Overlay";
import { PageHeader, Toolbar } from "@/components/ui/Page";
import { RagChip } from "@/components/ui/RagChip";
import { toOptions, useLookups } from "@/features/org/useReference";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useUrlFilters } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { RAG_LABEL } from "@/lib/status";
import type { Criticality, Rag } from "@/types/api";

interface CalendarEvent {
  item_id: string;
  item_code: string;
  name: string;
  unit: string | null;
  owner: string | null;
  criticality: Criticality;
  rag: Rag;
  bucket: string | null;
  event: string;
}

interface CalendarMonth {
  year: number;
  month: number;
  label: string;
  total: number;
  items: {
    item_id: string;
    item_code: string;
    name: string;
    date: string;
    rag: Rag;
    criticality: Criticality;
    owner: string | null;
    unit: string | null;
    status: string | null;
  }[];
}

interface CalendarPayload {
  months: CalendarMonth[];
  events: Record<string, CalendarEvent[]>;
  generated_for: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** How a day cell is tinted, from the worst band present that day. */
const CELL_TONE: Record<Rag, string> = {
  red: "bg-rag-red-bg border-rag-red-border text-rag-red",
  amber: "bg-rag-amber-bg border-rag-amber-border text-rag-amber",
  green: "bg-rag-green-bg border-rag-green-border text-rag-green",
  grey: "bg-surface-muted border-line text-ink-muted",
};

const RANK: Record<Rag, number> = { red: 3, amber: 2, green: 1, grey: 0 };

/** The most serious band among a day's events; "grey" when there are none. */
function worstRag(events: CalendarEvent[] | undefined): Rag {
  if (!events?.length) return "grey";
  return events.reduce<Rag>(
    (worst, event) => (RANK[event.rag] > RANK[worst] ? event.rag : worst),
    "grey",
  );
}

const EVENT_LABEL: Record<string, string> = {
  expiry_date: "Expires",
  renewal_due_date: "Renewal due",
  internal_target_date: "Internal target",
};

export default function CalendarPage() {
  const lookups = useLookups();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { filters, setFilter, reset, activeCount } = useUrlFilters({
    unit_id: "",
    department_id: "",
    category_id: "",
    view: "month",
    month: "0",
  });

  // The view and the visible month are URL state, not API filters — sending
  // them would refetch the whole calendar on every month click.
  const apiFilters = {
    unit_id: filters.unit_id,
    department_id: filters.department_id,
    category_id: filters.category_id,
  };

  const query = useQuery({
    queryKey: qk.dashboards.calendar(apiFilters),
    queryFn: () => api<CalendarPayload>("/dashboards/calendar", { query: apiFilters }),
  });

  const months = query.data?.months ?? [];
  const index = Math.min(Math.max(Number(filters.month ?? 0) || 0, 0), Math.max(months.length - 1, 0));
  const activeMonth = months[index];
  const view: "month" | "agenda" = filters.view === "agenda" ? "agenda" : "month";

  const days = useMemo(() => {
    if (!activeMonth) return [];
    const anchor = new Date(activeMonth.year, activeMonth.month - 1, 1);
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
    });
  }, [activeMonth]);

  const agendaDays = useMemo(() => {
    if (!activeMonth || !query.data) return [];
    const prefix = `${activeMonth.year}-${String(activeMonth.month).padStart(2, "0")}`;
    return Object.entries(query.data.events)
      .filter(([iso]) => iso.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [activeMonth, query.data]);

  const selectedEvents = selectedDay ? (query.data?.events[selectedDay] ?? []) : [];

  if (query.isPending) {
    return (
      <div>
        <PageHeader title="Renewal calendar" description="Loading the next twelve months…" />
        <div className="px-4 py-4 sm:px-6">
          <SkeletonRows rows={6} />
        </div>
      </div>
    );
  }

  if (query.error) {
    return (
      <div>
        <PageHeader title="Renewal calendar" />
        <ErrorState error={query.error} onRetry={() => query.refetch()} className="py-24" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Renewal calendar"
        description="Expiry dates, renewal due dates and internal targets, twelve months ahead."
        actions={
          <SegmentedControl
            label="Calendar view"
            value={view}
            onChange={(next) => setFilter("view", next)}
            options={[
              { value: "month", label: "Month", icon: "calendar-days" },
              { value: "agenda", label: "Agenda", icon: "list" },
            ]}
          />
        }
      />

      <Toolbar label="Calendar filters">
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
        {activeCount > 0 && (
          <Button variant="ghost" icon="x" onClick={reset}>
            Clear filters
          </Button>
        )}
      </Toolbar>

      <div className="px-4 py-4 sm:px-6 sm:py-5">
        {!months.length ? (
          <Card>
            <EmptyState
              icon="calendar"
              title="No dates in the next twelve months"
              description="Nothing in this scope has an expiry, renewal due date or internal target within a year."
            />
          </Card>
        ) : (
          <>
            {/* ---------------------- Month navigation ---------------------- */}
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <Button
                  size="icon"
                  variant="secondary"
                  icon="chevron-left"
                  aria-label="Previous month"
                  disabled={index <= 0}
                  onClick={() => setFilter("month", String(index - 1))}
                />
                <Button
                  size="icon"
                  variant="secondary"
                  icon="chevron-right"
                  aria-label="Next month"
                  disabled={index >= months.length - 1}
                  onClick={() => setFilter("month", String(index + 1))}
                />
              </div>
              <p className="text-center text-base font-semibold text-ink" aria-live="polite">
                {activeMonth?.label}
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  {activeMonth?.total ?? 0} {activeMonth?.total === 1 ? "date" : "dates"}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setFilter("month", "0")}
                className="rounded px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline-2"
              >
                Today
              </button>
            </div>

            {view === "month" ? (
              <Card className="p-2 sm:p-3">
                <div aria-label={`${activeMonth?.label} renewal calendar`}>
                  <div className="grid grid-cols-7 gap-1 pb-1">
                    {WEEKDAYS.map((day) => (
                      <div
                        key={day}
                        className="py-1 text-center text-2xs font-semibold tracking-wide text-ink-subtle uppercase"
                      >
                        <abbr title={day} className="no-underline">
                          {day}
                        </abbr>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {days.map((day) => {
                      const iso = format(day, "yyyy-MM-dd");
                      const events = query.data?.events[iso];
                      const rag = worstRag(events);
                      const inMonth = activeMonth
                        ? isSameMonth(day, new Date(activeMonth.year, activeMonth.month - 1, 1))
                        : false;
                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => setSelectedDay(iso)}
                          disabled={!events?.length}
                          aria-label={
                            events?.length
                              ? `${formatDate(iso)}: ${events.length} ${
                                  events.length === 1 ? "obligation" : "obligations"
                                }, worst status ${RAG_LABEL[rag]}`
                              : `${formatDate(iso)}: nothing due`
                          }
                          className={cn(
                            "flex min-h-16 flex-col items-start gap-1 rounded-[var(--radius-control)] border p-1.5 text-left transition-colors sm:min-h-20 sm:p-2",
                            inMonth ? "border-line" : "border-transparent",
                            // A day from the neighbouring month is recessed by
                            // dropping its tinted surface, not by fading the whole
                            // cell: at 45% opacity the date measured 2.1:1, and a
                            // date is not decorative text. The status dot keeps
                            // its colour, and the legend explains it.
                            inMonth && events?.length
                              ? CELL_TONE[rag]
                              : "bg-surface text-ink-subtle",
                            events?.length &&
                              "cursor-pointer hover:shadow-[var(--shadow-card)]",
                          )}
                        >
                          <span className="tabular text-xs font-semibold">{day.getDate()}</span>
                          {!!events?.length && (
                            <span className="mt-auto flex items-center gap-1">
                              <span
                                aria-hidden
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: `var(--color-rag-${rag})` }}
                              />
                              <span className="tabular text-2xs font-medium">{events.length}</span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* A legend, so the cell colour is never the only signal. */}
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-1 pt-3 text-2xs">
                  {(["red", "amber", "green"] as Rag[]).map((rag) => (
                    <li key={rag} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-2.5 rounded-sm"
                        style={{ backgroundColor: `var(--color-rag-${rag})` }}
                      />
                      <span className="text-ink-muted">{RAG_LABEL[rag]}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <Card>
                <CardHeader
                  title={`${activeMonth?.label} — agenda`}
                  description="Every date in this month, earliest first."
                />
                {agendaDays.length ? (
                  <ul className="divide-y divide-line">
                    {agendaDays.map(([iso, events]) => (
                      <li key={iso} className="px-4 py-3 sm:px-5">
                        <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
                          {formatDate(iso)}
                          <span className="text-2xs font-normal text-ink-subtle">
                            {events.length} {events.length === 1 ? "obligation" : "obligations"}
                          </span>
                        </p>
                        <ul className="space-y-2">
                          {events.map((event) => (
                            <li key={`${event.item_id}-${event.event}`}>
                              <Link
                                to={`/items/${event.item_id}`}
                                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-surface-muted"
                              >
                                <span className="min-w-0 flex-1 text-sm font-medium text-brand-700">
                                  {event.name}
                                </span>
                                <Chip>{EVENT_LABEL[event.event] ?? event.event}</Chip>
                                <CriticalityChip criticality={event.criticality} />
                                <RagChip rag={event.rag} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon="calendar"
                    title="Nothing due this month"
                    description="No expiry, renewal due date or internal target falls in this month for the current scope."
                  />
                )}
              </Card>
            )}
          </>
        )}
      </div>

      {/* The day's obligations. Bottom sheet on a phone, centred on a tablet. */}
      <Modal
        open={selectedDay !== null}
        onClose={() => setSelectedDay(null)}
        title={selectedDay ? formatDate(selectedDay) : ""}
        description={
          selectedEvents.length
            ? `${selectedEvents.length} ${selectedEvents.length === 1 ? "obligation" : "obligations"} on this date`
            : undefined
        }
        size="lg"
      >
        {selectedEvents.length ? (
          <ul className="space-y-2">
            {selectedEvents.map((event) => (
              <li key={`${event.item_id}-${event.event}`}>
                <Link
                  to={`/items/${event.item_id}`}
                  className="block rounded-[var(--radius-control)] border border-line p-3 hover:bg-surface-muted"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{event.name}</span>
                      <span className="block text-2xs text-ink-subtle">
                        {event.item_code}
                        {event.unit ? ` · ${event.unit}` : ""}
                        {event.owner ? ` · ${event.owner}` : ""}
                      </span>
                    </span>
                    <Icon name="arrow-up-right" size={15} className="mt-0.5 shrink-0 text-ink-subtle" />
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <Chip>{EVENT_LABEL[event.event] ?? event.event}</Chip>
                    <CriticalityChip criticality={event.criticality} />
                    <RagChip rag={event.rag} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="calendar"
            title="Nothing on this date"
            description="Pick a day with a count on it to see the obligations due."
          />
        )}
      </Modal>
    </div>
  );
}
