/**
 * Document upload, in one place.
 *
 * Both the vault screen and the obligation's Documents tab upload through the
 * same form, so validation, the progress bar and the field names stay in step.
 * The API takes multipart form fields (`title`, `doc_type`, `item_id`,
 * `instance_id`, `reference_number`, `issue_date`, `expiry_date`,
 * `change_note`, `file`) — exactly what `uploadFile` sends.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { ProgressBar, useToast } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { ApiError, api, uploadFile } from "@/lib/api";
import { invalidateRegister, qk, queryClient } from "@/lib/query";
import { stringsToOptions, useMeta } from "@/features/org/useReference";
import type { DocumentRow } from "@/features/documents/api-types";
import type { ComplianceItemSummary, Paginated } from "@/types/api";

export interface DocumentUploaderProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selected obligation; when null the user picks one (or none). */
  itemId?: string | null;
  instanceId?: string | null;
  /** Hides the obligation picker (the item detail page passes this). */
  lockItem?: boolean;
  itemLabel?: string | null;
  defaultDocType?: string;
  onUploaded?: (document: DocumentRow) => void;
}

/** Cheap, honest client-side check against the server's own limits. */
export function validateUpload(file: File, limits?: { maxMb: number; extensions: string[] }) {
  if (!limits) return null;
  const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (limits.extensions.length && !limits.extensions.includes(extension)) {
    return `“${extension}” files are not accepted. Allowed: ${limits.extensions.join(", ")}.`;
  }
  if (file.size > limits.maxMb * 1024 * 1024) {
    return `The file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${limits.maxMb} MB.`;
  }
  return null;
}

export function DocumentUploader({
  open,
  onClose,
  itemId = null,
  instanceId = null,
  lockItem = false,
  itemLabel = null,
  defaultDocType = "",
  onUploaded,
}: DocumentUploaderProps) {
  const toast = useToast();
  const meta = useMeta();

  // A short obligation list for the picker. The register is paged, so this
  // asks for the first 200 by name — enough to attach a file without turning
  // the upload dialog into a second search screen.
  const items = useQuery({
    queryKey: qk.items.list({ scope: "upload-picker", page_size: 200 }),
    queryFn: () =>
      api<Paginated<ComplianceItemSummary>>("/items", {
        query: { page_size: 200, sort: "name", direction: "asc" },
      }),
    enabled: open && !lockItem,
    staleTime: 5 * 60_000,
  });

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState(defaultDocType);
  const [chosenItem, setChosenItem] = useState(itemId ?? "");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const limits = useMemo(() => {
    const data = meta.data;
    if (!data) return undefined;
    return { maxMb: data.max_upload_mb, extensions: data.allowed_upload_extensions };
  }, [meta.data]);

  const reset = () => {
    setFile(null);
    setTitle("");
    setDocType(defaultDocType);
    setChosenItem(itemId ?? "");
    setReferenceNumber("");
    setIssueDate("");
    setExpiryDate("");
    setChangeNote("");
    setProgress(0);
    setFileError(null);
    setFormError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("title", title.trim());
      if (docType) form.append("doc_type", docType);
      const target = lockItem ? itemId ?? "" : chosenItem;
      if (target) form.append("item_id", target);
      if (instanceId) form.append("instance_id", instanceId);
      if (referenceNumber.trim()) form.append("reference_number", referenceNumber.trim());
      if (issueDate) form.append("issue_date", issueDate);
      if (expiryDate) form.append("expiry_date", expiryDate);
      if (changeNote.trim()) form.append("change_note", changeNote.trim());
      form.append("file", file as File);
      return (await uploadFile("/documents", form, setProgress)) as DocumentRow;
    },
    onSuccess: (document) => {
      toast.success(
        "Document uploaded",
        `${document.title} (v${document.version_no}) is on file.`,
      );
      invalidateRegister(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      onUploaded?.(document);
      close();
    },
    onError: (error) => {
      setFormError(error instanceof ApiError ? error.detail : "The upload failed. Try again.");
    },
  });

  const onPickFile = (next: File | null) => {
    setFile(next);
    setFileError(next ? validateUpload(next, limits) : null);
    if (next && !title.trim()) {
      // Default the title to the file name without its extension — one less
      // field to fill when a certificate has just been scanned.
      setTitle(next.name.replace(/\.[^.]+$/, ""));
    }
  };

  const canSubmit = Boolean(file) && title.trim().length > 0 && !fileError && !upload.isPending;

  const itemOptions = (items.data?.items ?? []).map((row) => ({
    value: row.id,
    label: `${row.item_code} · ${row.name}`,
  }));

  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload a document"
      description={
        lockItem && itemLabel
          ? `Attach a certificate, acknowledgement, challan or report to ${itemLabel}.`
          : "Attach a certificate, acknowledgement, challan or report."
      }
      size="lg"
      dismissible={!upload.isPending}
      footer={
        <>
          <Button onClick={close} disabled={upload.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="upload"
            onClick={() => upload.mutate()}
            disabled={!canSubmit}
            loading={upload.isPending}
            block
            className="sm:w-auto"
          >
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {lockItem && itemLabel ? (
          <p className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2 text-sm text-ink-muted">
            Filing against <span className="font-medium text-ink">{itemLabel}</span>
          </p>
        ) : (
          <Field label="Obligation" hint="Optional">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={chosenItem}
                onChange={(event) => setChosenItem(event.target.value)}
                placeholder="No obligation (general document)"
                options={itemOptions}
              />
            )}
          </Field>
        )}

        <Field
          label="File"
          required
          error={fileError}
          hint={
            limits
              ? `Up to ${limits.maxMb} MB · ${limits.extensions.join(", ")}`
              : "Choose the scanned copy"
          }
        >
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              type="file"
              onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
              className="block w-full cursor-pointer rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
            />
          )}
        </Field>

        {upload.isPending && <ProgressBar value={progress} label="Upload progress" />}

        <Field label="Title" required hint="Versions group by title and type">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Consent to Operate — FY2026-27"
            />
          )}
        </Field>

        <Field label="Document type">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={docType}
              onChange={(event) => setDocType(event.target.value)}
              placeholder="Other"
              options={stringsToOptions(meta.data?.document_type)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issue date">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            )}
          </Field>
          <Field label="Expiry date">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Reference number" hint="On the new certificate or receipt">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
            />
          )}
        </Field>

        <Field label="Change note" hint="What changed in this version">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={changeNote}
              onChange={(event) => setChangeNote(event.target.value)}
              rows={2}
            />
          )}
        </Field>

        {formError && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red"
          >
            {formError}
          </p>
        )}
      </div>
    </Modal>
  );
}
