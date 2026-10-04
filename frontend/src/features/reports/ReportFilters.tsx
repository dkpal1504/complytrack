/**
 * The report parameter bar.
 *
 * The report endpoint accepts exactly: unit_id, department_id, category_id,
 * criticality, owner_id, type, period_from, period_to (see
 * `backend/app/api/routes/reports.py`). Every value is kept in the URL by the
 * caller so a filtered report is shareable.
 */

import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { Toolbar } from "@/components/ui/Page";
import { cn } from "@/lib/cn";
import { stringsToOptions, toOptions, useLookups, useMeta } from "@/features/org/useReference";

/** A type alias, not an interface, so it satisfies `Record<string, unknown>`
 *  for `useUrlFilters` without an explicit index signature. */
export type ReportFilterValues = {
  unit_id: string;
  department_id: string;
  category_id: string;
  criticality: string;
  owner_id: string;
  type: string;
  period_from: string;
  period_to: string;
};

export const EMPTY_REPORT_FILTERS: ReportFilterValues = {
  unit_id: "",
  department_id: "",
  category_id: "",
  criticality: "",
  owner_id: "",
  type: "",
  period_from: "",
  period_to: "",
};

export function ReportFilters({
  values,
  onChange,
  onReset,
  activeCount,
  className,
}: {
  values: ReportFilterValues;
  onChange: (key: keyof ReportFilterValues, value: string) => void;
  onReset: () => void;
  activeCount: number;
  className?: string;
}) {
  const { data: lookups } = useLookups();
  const { data: meta } = useMeta();

  const fieldClass = "w-full sm:w-44";

  return (
    <Toolbar label="Report filters" className={cn("no-print", className)}>
      <Field label="Unit" className={fieldClass}>
        {({ id }) => (
          <Select
            id={id}
            placeholder="All units"
            value={values.unit_id}
            options={toOptions(lookups?.units, { withCode: true })}
            onChange={(event) => onChange("unit_id", event.target.value)}
          />
        )}
      </Field>
      <Field label="Department" className={fieldClass}>
        {({ id }) => (
          <Select
            id={id}
            placeholder="All departments"
            value={values.department_id}
            options={toOptions(lookups?.departments)}
            onChange={(event) => onChange("department_id", event.target.value)}
          />
        )}
      </Field>
      <Field label="Category" className={fieldClass}>
        {({ id }) => (
          <Select
            id={id}
            placeholder="All categories"
            value={values.category_id}
            options={toOptions(lookups?.categories)}
            onChange={(event) => onChange("category_id", event.target.value)}
          />
        )}
      </Field>
      <Field label="Criticality" className="w-full sm:w-36">
        {({ id }) => (
          <Select
            id={id}
            placeholder="Any"
            value={values.criticality}
            options={stringsToOptions(meta?.criticality)}
            onChange={(event) => onChange("criticality", event.target.value)}
          />
        )}
      </Field>
      <Field label="Owner" className={fieldClass}>
        {({ id }) => (
          <Select
            id={id}
            placeholder="Any owner"
            value={values.owner_id}
            options={toOptions(lookups?.users)}
            onChange={(event) => onChange("owner_id", event.target.value)}
          />
        )}
      </Field>
      <Field label="Type" className="w-full sm:w-40">
        {({ id }) => (
          <Select
            id={id}
            placeholder="Any type"
            value={values.type}
            options={stringsToOptions(meta?.item_type)}
            onChange={(event) => onChange("type", event.target.value)}
          />
        )}
      </Field>
      <Field label="From" className="w-full sm:w-40">
        {({ id }) => (
          <Input
            id={id}
            type="date"
            value={values.period_from}
            onChange={(event) => onChange("period_from", event.target.value)}
          />
        )}
      </Field>
      <Field label="To" className="w-full sm:w-40">
        {({ id }) => (
          <Input
            id={id}
            type="date"
            value={values.period_to}
            onChange={(event) => onChange("period_to", event.target.value)}
          />
        )}
      </Field>
      {activeCount > 0 && (
        <div className="flex items-end pb-0.5">
          <Button size="sm" variant="ghost" icon="x" onClick={onReset}>
            Clear filters
          </Button>
        </div>
      )}
    </Toolbar>
  );
}
