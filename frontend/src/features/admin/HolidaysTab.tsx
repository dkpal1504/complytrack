/**
 * The holiday calendar.
 *
 * Holidays are not decoration: the reminder engine counts *working* days
 * between reminders and the due date, so a missing holiday makes the system
 * chase a department on a day the office was shut, and a wrong one silently
 * shortens the warning a team gets.
 *
 * The API filters only by state, so the year filter here is applied to the
 * fetched calendar — the whole calendar is small enough to hold in one query.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, CountBadge } from "@/components/ui/Chip";
import { EmptyState, ErrorState, useToast } from "@/components/ui/Feedback";
import { Field, Input, Select } from "@/components/ui/Form";
import { ConfirmDialog, Modal } from "@/components/ui/Overlay";
import { ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { formatDate, todayIst } from "@/lib/format";
import { qk, invalidateAdmin } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import type { HolidayRow, UnitRow } from "@/features/admin/admin-types";

const ALL_STATES = "ALL";

interface FormState {
  state: string;
  date: string;
  name: string;
}

const EMPTY: FormState = { state: ALL_STATES, date: "", name: "" };

/**
 * One shared empty list rather than a fresh `[]` each render.
 *
 * While the query is loading the table and the two option lists below are keyed
 * on this value; a new array every render would make all three recompute on
 * every render of the tab.
 */
const NO_HOLIDAYS: HolidayRow[] = [];

/** `Monday` — the weekday name for a calendar date, matching `formatDate`. */
function weekday(isoDate: string) {
  const date = parseISO(isoDate);
  return isValid(date) ? format(date, "EEEE") : "—";
}

export function HolidaysTab() {
  const { can } = useAuth();
  const canManage = can(PERM.MANAGE_ORG);
  const queryClient = useQueryClient();
  const toast = useToast();

  // The IST year, not the device's: the holiday list is a calendar of Indian
  // working days, and on 1 January a browser behind IST would still offer the
  // year that has just ended.
  const thisYear = Number(todayIst().slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const [state, setState] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<HolidayRow | null>(null);

  const query = useQuery({
    queryKey: qk.org.holidays,
    queryFn: () => api<HolidayRow[]>("/org/holidays"),
  });

  /** The states a unit operates in, so the picker offers real choices. */
  const units = useQuery({
    queryKey: qk.org.units,
    queryFn: () => api<UnitRow[]>("/org/units"),
    staleTime: 5 * 60_000,
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<HolidayRow>("/org/holidays", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success("Holiday added", "Working-day calculations now use this calendar.");
      void queryClient.invalidateQueries({ queryKey: qk.org.holidays });
      invalidateAdmin(queryClient);
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not add the holiday", error.detail);
      } else {
        toast.error("Could not add the holiday");
      }
    },
  });

  const remove = useMutation({
    mutationFn: (holiday: HolidayRow) =>
      api<{ detail: string }>(`/org/holidays/${holiday.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Holiday removed");
      void queryClient.invalidateQueries({ queryKey: qk.org.holidays });
      invalidateAdmin(queryClient);
      setRemoving(null);
    },
    onError: (error) => {
      toast.error(
        "Could not remove the holiday",
        error instanceof ApiError ? error.detail : undefined,
      );
      setRemoving(null);
    },
  });

  const rows = query.data ?? NO_HOLIDAYS;

  const years = useMemo(() => {
    const found = new Set(rows.map((row) => row.date.slice(0, 4)));
    found.add(String(thisYear));
    return [...found].sort((a, b) => b.localeCompare(a));
  }, [rows, thisYear]);

  const stateOptions = useMemo(() => {
    const found = new Set<string>([ALL_STATES]);
    for (const unit of units.data ?? []) if (unit.state) found.add(unit.state);
    for (const holiday of rows) if (holiday.state) found.add(holiday.state);
    return [...found].sort();
  }, [units.data, rows]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (year && row.date.slice(0, 4) !== year) return false;
        if (state && row.state !== state) return false;
        return true;
      }),
    [rows, year, state],
  );

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (form.name.trim().length < 2) nextErrors.name = "Give the holiday a name.";
    if (!form.date) nextErrors.date = "Pick the date of the holiday.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    create.mutate({
      state: form.state || ALL_STATES,
      date: form.date,
      name: form.name.trim(),
    });
  };

  const columns: Column<HolidayRow>[] = [
    {
      key: "name",
      header: "Holiday",
      isTitle: true,
      sortValue: (row) => row.name,
      cell: (row) => <span className="font-medium text-ink">{row.name}</span>,
    },
    {
      key: "date",
      header: "Date",
      sortValue: (row) => row.date,
      cell: (row) => <span className="tabular">{formatDate(row.date)}</span>,
    },
    {
      key: "day",
      header: "Day",
      hideBelow: "md",
      sortValue: (row) => parseISO(row.date).getDay(),
      cell: (row) => weekday(row.date),
    },
    {
      key: "state",
      header: "Applies to",
      sortValue: (row) => row.state,
      cell: (row) =>
        row.state === ALL_STATES ? (
          <Chip icon="map" title="A nationwide holiday">
            All states
          </Chip>
        ) : (
          <Chip icon="map">{row.state}</Chip>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      mobileLabel: "Actions",
      cell: (row) =>
        canManage ? (
          <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(row)}>
            Remove
          </Button>
        ) : null,
    },
  ];

  const yearCount = rows.filter((row) => row.date.slice(0, 4) === year).length;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Holiday calendar</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              Working-day countdowns skip these dates, so every holiday the factory observes belongs
              here. A holiday tagged “All states” applies to every unit.
            </p>
          </div>
          {canManage && (
            <Button
              variant="primary"
              icon="plus"
              size="sm"
              onClick={() => {
                setForm({ ...EMPTY, date: `${year}-01-01` });
                setErrors({});
                setOpen(true);
              }}
            >
              Add holiday
            </Button>
          )}
        </div>

        <Toolbar label="Holiday filters">
          <div className="flex items-center gap-2">
            <label htmlFor="holiday-year" className="text-xs font-semibold text-ink">
              Year
            </label>
            <Select
              id="holiday-year"
              aria-label="Holiday year"
              value={year}
              className="w-28"
              options={years.map((value) => ({ value, label: value }))}
              onChange={(event) => setYear(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="holiday-state" className="text-xs font-semibold text-ink">
              State
            </label>
            <Select
              id="holiday-state"
              aria-label="Holiday state"
              value={state}
              placeholder="All states"
              options={stateOptions
                .filter((value) => value !== ALL_STATES)
                .map((value) => ({ value, label: value }))}
              onChange={(event) => setState(event.target.value)}
            />
          </div>
          <ResultCount
            shown={filtered.length}
            total={yearCount}
            noun={`holiday in ${year}`}
            className="sm:ml-auto"
          />
        </Toolbar>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption={`Holidays in ${year}`}
            columns={columns}
            rows={filtered}
            getRowId={(row) => row.id}
            loading={query.isPending}
            empty={
              <EmptyState
                icon="calendar"
                title={`No holidays recorded for ${year}`}
                description="If the calendar is empty for a year, reminders are counted as if every day were a working day."
                action={
                  canManage ? (
                    <Button
                      variant="primary"
                      icon="plus"
                      onClick={() => {
                        setForm({ ...EMPTY, date: `${year}-01-01` });
                        setOpen(true);
                      }}
                    >
                      Add holiday
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}

        <div className="flex items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
          <CountBadge value={yearCount} />
          <p className="text-2xs text-ink-muted">
            working dates excluded for {year}. The reminder engine counts preparation days across
            this calendar.
          </p>
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add holiday"
        description="Use “ALL” for a nationwide holiday, or a state name for a regional one."
        footer={
          <>
            <Button onClick={() => setOpen(false)} className="sm:w-auto" block>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="save"
              onClick={submit}
              loading={create.isPending}
              className="sm:w-auto"
              block
            >
              Add holiday
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required error={errors.name}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. Diwali"
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" required error={errors.date}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="date"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                />
              )}
            </Field>
            <Field label="Applies to" hint="ALL, or a state name">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.state}
                  options={stateOptions.map((value) => ({
                    value,
                    label: value === ALL_STATES ? "All states" : value,
                  }))}
                  onChange={(event) => setForm({ ...form, state: event.target.value })}
                />
              )}
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        loading={remove.isPending}
        title="Remove this holiday?"
        confirmLabel="Remove holiday"
        message={
          <>
            <p>
              <span className="font-medium text-ink">{removing?.name}</span> on{" "}
              {removing ? formatDate(removing.date) : ""} will no longer be skipped when the engine
              counts preparation days.
            </p>
            <p className="mt-2">
              The removal is recorded in the audit trail.
            </p>
          </>
        }
      />
    </>
  );
}
