/**
 * Download, verify, version history and delete — the four things a document
 * row can do, in one place so the vault and an obligation's Documents tab
 * behave identically.
 *
 * Verification is shown as the server reports it: the expected SHA-256, the
 * hash it actually re-computed, and whether they match. That is the whole point
 * of the integrity check (DS-09), so the dialog never reduces it to a tick.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, SkeletonRows, useToast } from "@/components/ui/Feedback";
import { Field, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { Icon } from "@/components/ui/Icon";
import { ApiError, api, apiFile, saveBlob } from "@/lib/api";
import { invalidateRegister, queryClient } from "@/lib/query";
import { formatBytes, formatDateTime } from "@/lib/format";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/cn";
import type { DocumentRow, VerifyResult } from "@/features/documents/api-types";

export interface DocumentActionButtonsProps {
  document: DocumentRow;
  onChanged?: () => void;
  /** Hides the buttons that make no sense in a narrow row. */
  compact?: boolean;
}

export function DocumentActionButtons({ document, onChanged, compact }: DocumentActionButtonsProps) {
  const { can } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<"verify" | "versions" | "delete" | null>(null);
  const [downloading, setDownloading] = useState(false);

  const canDownload = can(PERM.DOWNLOAD_DOCS);
  const canVerify = can(PERM.VIEW_AUDIT);
  const canDelete = can(PERM.DELETE_ARCHIVE);

  const download = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await apiFile(`/documents/${document.id}/download`);
      saveBlob(blob, filename);
    } catch (error) {
      toast.error("Download failed", error instanceof ApiError ? error.detail : undefined);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap justify-end gap-1">
        {canDownload && (
          <Button
            size="sm"
            variant="ghost"
            icon="download"
            onClick={() => void download()}
            loading={downloading}
            aria-label={`Download ${document.title}`}
          >
            {compact ? undefined : "Download"}
          </Button>
        )}
        {canVerify && (
          <Button
            size="sm"
            variant="ghost"
            icon="shield-check"
            onClick={() => setMode("verify")}
            aria-label={`Verify the integrity of ${document.title}`}
          >
            {compact ? undefined : "Verify"}
          </Button>
        )}
        {canDownload && (
          <Button
            size="sm"
            variant="ghost"
            icon="history"
            onClick={() => setMode("versions")}
            aria-label={`Version history of ${document.title}`}
          >
            {compact ? undefined : "Versions"}
          </Button>
        )}
        {canDelete && (
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            onClick={() => setMode("delete")}
            aria-label={`Remove ${document.title}`}
          >
            {compact ? undefined : "Remove"}
          </Button>
        )}
      </div>

      {mode === "verify" && (
        <VerifyDialog document={document} onClose={() => setMode(null)} />
      )}
      {mode === "versions" && (
        <VersionsDialog document={document} onClose={() => setMode(null)} />
      )}
      {mode === "delete" && (
        <DeleteDialog
          document={document}
          onClose={() => setMode(null)}
          onDone={onChanged}
        />
      )}
    </>
  );
}

/* -------------------------------- verify -------------------------------- */

function VerifyDialog({ document, onClose }: { document: DocumentRow; onClose: () => void }) {
  const check = useQuery({
    queryKey: ["documents", document.id, "verify"],
    queryFn: () => api<VerifyResult>(`/documents/${document.id}/verify`),
    retry: false,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Integrity check"
      description={document.file_name}
      size="md"
      footer={
        <Button onClick={onClose} block className="sm:w-auto">
          Close
        </Button>
      }
    >
      {check.isPending ? (
        <SkeletonRows rows={3} />
      ) : check.isError ? (
        <ErrorState error={check.error} onRetry={() => void check.refetch()} />
      ) : (
        <div className="space-y-4">
          <div
            className={cn(
              "flex items-start gap-3 rounded-[var(--radius-control)] border px-3 py-3",
              check.data.ok
                ? "border-rag-green-border bg-rag-green-bg"
                : "border-rag-red-border bg-rag-red-bg",
            )}
          >
            <Icon
              name={check.data.ok ? "shield-check" : "shield-alert"}
              size={20}
              className={cn("mt-0.5 shrink-0", check.data.ok ? "text-rag-green" : "text-rag-red")}
            />
            <div className="text-sm">
              <p className={cn("font-semibold", check.data.ok ? "text-rag-green" : "text-rag-red")}>
                {check.data.ok
                  ? "The stored file matches its recorded hash."
                  : "The stored file does not match its recorded hash."}
              </p>
              <p className="text-ink-muted">
                {check.data.ok
                  ? "Nothing has altered it since it was uploaded."
                  : check.data.reason ?? "Treat this document as unreliable and re-upload it."}
              </p>
            </div>
          </div>

          <dl className="space-y-3">
            <div>
              <dt className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">
                Recorded at upload
              </dt>
              <dd className="mt-0.5 font-mono text-xs break-all text-ink">{check.data.expected}</dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">
                Computed now
              </dt>
              <dd className="mt-0.5 font-mono text-xs break-all text-ink">
                {check.data.actual ?? "The file could not be read."}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">
                Virus scan
              </dt>
              <dd className="mt-0.5 text-sm text-ink">{document.virus_scan_status ?? "Not recorded"}</dd>
            </div>
          </dl>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------- versions ------------------------------- */

function VersionsDialog({ document, onClose }: { document: DocumentRow; onClose: () => void }) {
  const versions = useQuery({
    queryKey: ["documents", document.id, "versions"],
    queryFn: () => api<DocumentRow[]>(`/documents/${document.id}/versions`),
    retry: false,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Version history"
      description={`${document.title} — every version the vault holds.`}
      size="lg"
      footer={
        <Button onClick={onClose} block className="sm:w-auto">
          Close
        </Button>
      }
    >
      {versions.isPending ? (
        <SkeletonRows rows={4} />
      ) : versions.isError ? (
        <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
      ) : (versions.data ?? []).length === 0 ? (
        <EmptyState icon="document" title="No versions found" />
      ) : (
        <ul className="space-y-2">
          {(versions.data ?? []).map((version) => (
            <li
              key={version.id}
              className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Chip icon="document">v{version.version_no}</Chip>
                {version.is_current && (
                  <Chip className="border-rag-green-border bg-rag-green-bg text-rag-green">
                    Current
                  </Chip>
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{version.file_name}</span>
                <span className="text-2xs text-ink-subtle">{formatBytes(version.size_bytes)}</span>
              </div>
              <p className="mt-1 text-2xs text-ink-muted">
                {formatDateTime(version.created_at)}
                {version.change_note ? ` · ${version.change_note}` : ""}
              </p>
              <p className="mt-0.5 font-mono text-2xs break-all text-ink-subtle">{version.sha256}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* -------------------------------- delete -------------------------------- */

function DeleteDialog({
  document,
  onClose,
  onDone,
}: {
  document: DocumentRow;
  onClose: () => void;
  onDone?: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("reason", reason.trim());
      return api<{ detail: string }>(`/documents/${document.id}`, {
        method: "DELETE",
        body: form,
      });
    },
    onSuccess: (data) => {
      toast.success("Document removed", data.detail);
      invalidateRegister(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDone?.();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.detail : "The document could not be removed."),
  });

  const canSubmit = reason.trim().length >= 3 && !mutation.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title="Remove this document?"
      size="sm"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            loading={mutation.isPending}
            block
            className="sm:w-auto"
          >
            Remove
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">{document.file_name}</span> will be withdrawn from
          the vault. It is kept for audit and its removal is recorded against your name.
        </p>
        <Field label="Reason" required hint="At least 3 characters">
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Superseded by the renewal certificate uploaded today."
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
