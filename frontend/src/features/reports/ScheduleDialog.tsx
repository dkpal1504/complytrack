/**
 * Create a recurring report email (RP-10).
 *
 * The API accepts report_code, name, frequency, recipients[], format and a
 * filters object (see `ScheduleReportRequest`). Frequency is a free string but
 * the scheduler only understands daily/weekly/monthly/quarterly.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Overlay";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query";
import type { ScheduledReport } from "@/types/api";
import type { ReportCatalogueEntry, ScheduleInput } from "@/features/reports/report-types";

const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly"];
const FORMATS = ["pdf", "xlsx", "csv"];

function parseRecipients(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ScheduleDialog({
  open,
  onClose,
  reportCode,
  reportName,
  defaultName,
  filters,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Fixed when opened from a report; omitted to let the user pick one. */
  reportCode?: string;
  reportName?: string;
  defaultName?: string;
  filters?: Record<string, unknown>;
  onCreated?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(reportCode ?? "");
  const [name, setName] = useState(defaultName ?? "");
  const [frequency, setFrequency] = useState("weekly");
  const [format, setFormat] = useState("pdf");
  const [recipientsText, setRecipientsText] = useState("");
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const { data: catalogue } = useQuery({
    queryKey: qk.reports.catalogue,
    queryFn: () => api<ReportCatalogueEntry[]>("/reports"),
    enabled: open && !reportCode,
  });

  useEffect(() => {
    if (!open) return;
    setCode(reportCode ?? "");
    setName(defaultName ?? "");
    setRecipientsText("");
    setRecipientsError(null);
    setCodeError(null);
  }, [open, reportCode, defaultName]);

  const mutation = useMutation({
    mutationFn: (payload: ScheduleInput) =>
      api<ScheduledReport>("/reports/schedules", { method: "POST", json: payload }),
    onSuccess: (schedule) => {
      toast.success("Schedule created", `“${schedule.name}” will be emailed ${schedule.frequency}.`);
      void queryClient.invalidateQueries({ queryKey: qk.reports.schedules });
      onCreated?.();
      onClose();
    },
    onError: (error) => {
      toast.error(
        "Could not create the schedule",
        error instanceof ApiError ? error.detail : "Please try again.",
      );
    },
  });

  const submit = () => {
    const recipients = parseRecipients(recipientsText);
    const invalid = recipients.filter((email) => !EMAIL.test(email));
    let blocked = false;

    if (!code) {
      setCodeError("Choose the report to schedule.");
      blocked = true;
    } else {
      setCodeError(null);
    }
    if (recipients.length === 0) {
      setRecipientsError("Add at least one email recipient.");
      blocked = true;
    } else if (invalid.length > 0) {
      setRecipientsError(`Not a valid email: ${invalid.join(", ")}`);
      blocked = true;
    } else {
      setRecipientsError(null);
    }
    if (blocked) return;

    mutation.mutate({
      report_code: code,
      name: name.trim() || code,
      frequency,
      recipients,
      format,
      filters: filters ?? {},
    });
  };

  const selected = catalogue?.find((entry) => entry.code === code);
  const fixedName = reportName ?? selected?.name;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule this report"
      description="The report is built and emailed on the chosen cadence by the daily scheduler."
      size="md"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="mail-check"
            onClick={submit}
            loading={mutation.isPending}
            block
            className="sm:w-auto"
          >
            Create schedule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!reportCode && (
          <Field label="Report" required error={codeError}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                placeholder="Choose a report"
                value={code}
                aria-describedby={describedBy}
                options={(catalogue ?? []).map((entry) => ({
                  value: entry.code,
                  label: `${entry.code} · ${entry.name}`,
                }))}
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </Field>
        )}
        {fixedName && (
          <p className="text-sm text-ink-muted">
            Report: <span className="font-medium text-ink">{fixedName}</span>
          </p>
        )}

        <Field label="Schedule name" hint="Defaults to the report code if left blank.">
          {({ id }) => (
            <Input
              id={id}
              value={name}
              placeholder="Weekly compliance digest"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Frequency">
            {({ id }) => (
              <Select
                id={id}
                value={frequency}
                options={FREQUENCIES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
                onChange={(event) => setFrequency(event.target.value)}
              />
            )}
          </Field>
          <Field label="Format">
            {({ id }) => (
              <Select
                id={id}
                value={format}
                options={FORMATS.map((value) => ({ value, label: value.toUpperCase() }))}
                onChange={(event) => setFormat(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Recipients"
          required
          error={recipientsError}
          hint="Separate several addresses with commas."
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={2}
              invalid={invalid}
              aria-describedby={describedBy}
              value={recipientsText}
              placeholder="factory.manager@example.com, safety.head@example.com"
              onChange={(event) => setRecipientsText(event.target.value)}
            />
          )}
        </Field>

        <p className="text-2xs text-ink-subtle">
          The report is generated with the filters you are viewing now and delivered after the next
          daily sweep (07:15 IST).
        </p>
      </div>
    </Modal>
  );
}
