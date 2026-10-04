/**
 * Bulk import (CD-09 / Section 12).
 *
 * Three steps, and the middle one is the point: nothing is written until the
 * preview has shown every row, every error and every warning, and the commit is
 * refused outright when the file has no valid rows at all. The same file is
 * posted again at commit time — the API re-validates rather than trusting the
 * preview — so the wizard keeps the `File` object rather than a token.
 */

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import {
  EmptyState,
  ProgressBar,
  useToast,
} from "@/components/ui/Feedback";
import { Field } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { Icon } from "@/components/ui/Icon";
import { ApiError, saveBlob, uploadFile } from "@/lib/api";
import { invalidateRegister, queryClient } from "@/lib/query";
import { formatBytes, formatDate } from "@/lib/format";
import { useMeta } from "@/features/org/useReference";
import type {
  ImportCommitResult,
  ImportIssue,
  ImportPreviewResult,
} from "@/features/register/api-types";

type Step = "file" | "preview" | "done";

const STEP_LABEL: Record<Step, string> = {
  file: "Choose file",
  preview: "Check the preview",
  done: "Imported",
};

/** Builds a CSV of the issues the API reported, so the fixes can be worked through. */
function issuesToCsv(issues: ImportIssue[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = ["Row", "Column", "Severity", "Message"].join(",");
  const lines = issues.map((issue) =>
    [issue.row, issue.column ?? "", issue.severity, issue.message].map(escape).join(","),
  );
  return [header, ...lines].join("\r\n");
}

export interface ImportWizardProps {
  open: boolean;
  onClose: () => void;
}

export function ImportWizard({ open, onClose }: ImportWizardProps) {
  const toast = useToast();
  const meta = useMeta();

  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [result, setResult] = useState<ImportCommitResult | null>(null);

  const reset = () => {
    setStep("file");
    setFile(null);
    setFileError(null);
    setProgress(0);
    setBusy(false);
    setFormError(null);
    setPreview(null);
    setResult(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const validate = (next: File | null) => {
    setFileError(null);
    if (!next) return;
    const name = next.name.toLowerCase();
    if (!/\.(xlsx|xlsm|csv)$/.test(name)) {
      setFileError("Use the ComplyTrack template (.xlsx) or a CSV exported from it.");
      return;
    }
    const maxMb = meta.data?.max_upload_mb;
    if (maxMb && next.size > maxMb * 1024 * 1024) {
      setFileError(`The file is larger than the ${maxMb} MB limit.`);
    }
  };

  const runPreview = async () => {
    if (!file) return;
    setBusy(true);
    setFormError(null);
    setProgress(0);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = (await uploadFile(
        "/items/import/preview",
        form,
        setProgress,
      )) as ImportPreviewResult;
      setPreview(data);
      setStep("preview");
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.detail : "The file could not be read by the server.",
      );
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    if (!file || !preview || preview.valid_rows === 0) return;
    setBusy(true);
    setFormError(null);
    setProgress(0);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = (await uploadFile(
        "/items/import/commit",
        form,
        setProgress,
      )) as ImportCommitResult;
      setResult(data);
      setStep("done");
      invalidateRegister(queryClient);
      toast.success(
        "Import committed",
        `${data.created} created, ${data.updated} updated, ${data.skipped} skipped.`,
      );
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.detail : "The import could not be committed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const allIssues = useMemo(
    () => [...(preview?.errors ?? []), ...(preview?.warnings ?? [])],
    [preview],
  );

  const downloadIssues = (issues: ImportIssue[]) => {
    if (!issues.length) return;
    saveBlob(new Blob([issuesToCsv(issues)], { type: "text/csv;charset=utf-8" }), "complytrack-import-issues.csv");
  };

  const canCommit = Boolean(preview && preview.valid_rows > 0) && !busy;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import obligations"
      description={`Step ${step === "file" ? 1 : step === "preview" ? 2 : 3} of 3 · ${STEP_LABEL[step]}`}
      size="xl"
      dismissible={!busy}
      footer={
        step === "file" ? (
          <>
            <Button onClick={close} disabled={busy} block className="sm:w-auto">
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="search"
              onClick={() => void runPreview()}
              disabled={!file || Boolean(fileError) || busy}
              loading={busy}
              block
              className="sm:w-auto"
            >
              Check the file
            </Button>
          </>
        ) : step === "preview" ? (
          <>
            <Button
              onClick={() => setStep("file")}
              disabled={busy}
              icon="arrow-left"
              block
              className="sm:w-auto"
            >
              Choose a different file
            </Button>
            <Button
              variant="primary"
              icon="upload"
              onClick={() => void runCommit()}
              disabled={!canCommit}
              loading={busy}
              block
              className="sm:w-auto"
            >
              Import {preview?.valid_rows ?? 0} row{preview?.valid_rows === 1 ? "" : "s"}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={close} block className="sm:w-auto">
            Done
          </Button>
        )
      }
    >
      {step === "file" && (
        <div className="space-y-4">
          <p className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2 text-sm text-ink-muted">
            The file is checked before anything is written. You will see every row, every error and
            every warning before you commit.
          </p>

          <Field
            label="Import file"
            required
            error={fileError}
            hint=".xlsx template or a .csv with the same columns"
          >
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                type="file"
                accept=".xlsx,.xlsm,.csv"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  validate(next);
                }}
                className="block w-full cursor-pointer rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
              />
            )}
          </Field>

          {file && !fileError && (
            <p className="flex items-center gap-2 text-xs text-ink-muted">
              <Icon name="document" size={14} />
              {file.name} · {formatBytes(file.size)}
            </p>
          )}

          {busy && <ProgressBar value={progress} label="Uploading" />}

          {formError && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
              {formError}
            </p>
          )}
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows in the file" value={preview.total_rows} />
            <Stat label="Ready to import" value={preview.valid_rows} tone="green" />
            <Stat label="Errors" value={preview.errors.length} tone={preview.errors.length ? "red" : undefined} />
            <Stat label="Warnings" value={preview.warnings.length} tone={preview.warnings.length ? "amber" : undefined} />
          </dl>

          {preview.valid_rows === 0 ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2.5 text-sm text-rag-red"
            >
              <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
              <span>
                Nothing in this file can be imported. Fix the errors below and upload it again — no
                rows have been written.
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-amber-border bg-rag-amber-bg px-3 py-2.5 text-xs text-rag-amber">
              <Icon name="info" size={15} className="mt-0.5 shrink-0" />
              <span>
                {preview.valid_rows} row{preview.valid_rows === 1 ? "" : "s"} will be created or
                updated. Rows with errors are skipped; rows with warnings are imported with the
                warning applied.
              </span>
            </p>
          )}

          {allIssues.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">
                  Issues <span className="tabular text-ink-muted">({allIssues.length})</span>
                </h3>
                <Button size="sm" icon="download" onClick={() => downloadIssues(allIssues)}>
                  Download issues
                </Button>
              </div>
              <ul className="scroll-thin max-h-56 space-y-1.5 overflow-y-auto">
                {allIssues.slice(0, 200).map((issue, index) => (
                  <li
                    key={`${issue.row}-${index}`}
                    className="flex items-start gap-2 rounded-[var(--radius-control)] border border-line bg-surface-muted px-2.5 py-1.5 text-xs"
                  >
                    <Chip
                      className={
                        issue.severity === "error"
                          ? "border-rag-red-border bg-rag-red-bg text-rag-red"
                          : "border-rag-amber-border bg-rag-amber-bg text-rag-amber"
                      }
                    >
                      Row {issue.row}
                    </Chip>
                    <span className="min-w-0 flex-1 text-ink">
                      {issue.column ? <span className="font-medium">{issue.column}: </span> : null}
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
              {allIssues.length > 200 && (
                <p className="mt-1.5 text-2xs text-ink-subtle">
                  Showing the first 200 issues. Download the full list to work through them.
                </p>
              )}
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">
              Rows that will be imported
              <span className="tabular ml-1 text-ink-muted">({preview.preview.length})</span>
            </h3>
            {preview.preview.length === 0 ? (
              <EmptyState
                icon="spreadsheet"
                title="No valid rows"
                description="Every row in this file has at least one error."
              />
            ) : (
              <div className="scroll-thin max-h-72 overflow-auto rounded-[var(--radius-control)] border border-line">
                <table className="w-full border-collapse text-xs">
                  <caption className="sr-only">Rows that will be imported</caption>
                  <thead className="sticky top-0 bg-surface-muted">
                    <tr className="border-b border-line text-left text-2xs tracking-wide text-ink-muted uppercase">
                      <th scope="col" className="px-2 py-2">Row</th>
                      <th scope="col" className="px-2 py-2">Name</th>
                      <th scope="col" className="px-2 py-2">Unit</th>
                      <th scope="col" className="px-2 py-2">Type</th>
                      <th scope="col" className="px-2 py-2">Expiry</th>
                      <th scope="col" className="px-2 py-2">Criticality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row) => (
                      <tr key={row.row} className="border-b border-line last:border-0">
                        <td className="tabular px-2 py-1.5 text-ink-muted">{row.row}</td>
                        <td className="px-2 py-1.5 font-medium text-ink">{row.name}</td>
                        <td className="px-2 py-1.5 text-ink-muted">{row.unit ?? "—"}</td>
                        <td className="px-2 py-1.5 text-ink-muted">{row.type}</td>
                        <td className="px-2 py-1.5 text-ink-muted">{formatDate(row.expiry_date)}</td>
                        <td className="px-2 py-1.5 text-ink-muted">{row.criticality}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {busy && <ProgressBar value={progress} label="Importing" />}

          {formError && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
              {formError}
            </p>
          )}
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-[var(--radius-control)] border border-rag-green-border bg-rag-green-bg px-3 py-3">
            <Icon name="check-circle" size={20} className="mt-0.5 shrink-0 text-rag-green" />
            <div className="text-sm text-ink">
              <p className="font-semibold">Import finished.</p>
              <p className="text-ink-muted">
                The register, dashboards and reports have been refreshed.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Created" value={result.created} tone="green" />
            <Stat label="Updated" value={result.updated} />
            <Stat label="Skipped" value={result.skipped} tone={result.skipped ? "amber" : undefined} />
          </dl>

          {result.errors.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">
                  Rows that could not be imported
                  <span className="tabular ml-1 text-ink-muted">({result.errors.length})</span>
                </h3>
                <Button size="sm" icon="download" onClick={() => downloadIssues(result.errors)}>
                  Download issues
                </Button>
              </div>
              <ul className="scroll-thin max-h-56 space-y-1.5 overflow-y-auto">
                {result.errors.slice(0, 200).map((issue, index) => (
                  <li
                    key={`${issue.row}-${index}`}
                    className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-2.5 py-1.5 text-xs text-ink"
                  >
                    <span className="font-medium">Row {issue.row}: </span>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState
              icon="check-circle"
              title="Every valid row was imported"
              description="The skipped rows, if any, had already been archived or were outside your scope."
            />
          )}
        </div>
      )}

    </Modal>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "amber" | "red";
}) {
  const tones = {
    green: "text-rag-green",
    amber: "text-rag-amber",
    red: "text-rag-red",
  } as const;
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5">
      <dt className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">{label}</dt>
      <dd className={`tabular mt-0.5 text-2xl font-semibold ${tone ? tones[tone] : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}
