/**
 * The document checklist for a cycle (RT-03 / DS-02).
 *
 * The API's checklist update takes a status and a note and nothing else —
 * there is no field to point a tick at a specific uploaded file — so the panel
 * does not pretend otherwise. Ticking a line records who marked it and when;
 * attaching the actual PDF is a separate step, offered right beside it, because
 * that is how the two really relate in the API.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, Meter, SkeletonRows, useToast } from "@/components/ui/Feedback";
import { Field, Select, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { Icon } from "@/components/ui/Icon";
import { ApiError, api } from "@/lib/api";
import { invalidateRegister, qk, queryClient } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { DocumentUploader } from "@/features/documents/DocumentUploader";
import type {
  ChecklistLine,
  CycleSummary,
  ItemDetail,
  WorkflowInstanceResponse,
} from "@/features/register/api-types";
import type { ChecklistStatus } from "@/types/api";

const STATUS_TONE: Record<string, string> = {
  Received: "border-rag-green-border bg-rag-green-bg text-rag-green",
  Pending: "border-line bg-surface-muted text-ink-muted",
  "Not Required": "border-line bg-surface-muted text-ink-subtle",
};

export interface ChecklistPanelProps {
  item: ItemDetail;
  instance: CycleSummary;
  onChanged: () => void;
}

export function ChecklistPanel({ item, instance, onChanged }: ChecklistPanelProps) {
  const [target, setTarget] = useState<ChecklistLine | null>(null);
  const [uploadFor, setUploadFor] = useState<ChecklistLine | null>(null);

  const detail = useQuery({
    queryKey: qk.instances.detail(instance.id),
    queryFn: () => api<WorkflowInstanceResponse>(`/instances/${instance.id}`),
    retry: false,
  });

  const progress = detail.data?.progress ?? instance.progress;
  const lines = detail.data?.checklist ?? [];

  if (detail.isPending) return <SkeletonRows rows={4} />;

  if (detail.isError) {
    return (
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">Document checklist</h3>
          <Meter
            done={progress.received}
            total={progress.total}
            waived={progress.total - progress.received - progress.pending}
          />
        </div>
        <ErrorState
          error={detail.error}
          title="The checklist could not be loaded"
          onRetry={() => void detail.refetch()}
        />
        <p className="mt-3 text-xs text-ink-muted">
          The checklist lines come from <code>GET /instances/{"{id}"}</code>, which returned an
          error. The progress figure above is taken from the obligation record instead. You can
          still upload documents for this cycle from the Documents tab.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {instance.cycle_label} — documents the authority expects
            </h3>
            <p className="text-2xs text-ink-subtle">
              Each line is a document the filing needs. Tick it once the file is on record.
            </p>
          </div>
          <Meter
            done={progress.received}
            total={progress.total}
            waived={progress.total - progress.received - progress.pending}
          />
        </div>

        {lines.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No checklist for this cycle"
            description="This obligation's template does not list any documents for the renewal."
          />
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5">
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border ${
                    line.status === "Received"
                      ? "border-rag-green-border bg-rag-green-bg text-rag-green"
                      : "border-line-strong bg-surface-muted text-ink-subtle"
                  }`}
                >
                  <Icon name={line.status === "Received" ? "check" : "document"} size={13} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-ink">{line.item_name}</span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium ${
                        STATUS_TONE[line.status] ?? STATUS_TONE.Pending
                      }`}
                    >
                      {line.status}
                    </span>
                  </div>
                  {line.status === "Received" && line.received_at && (
                    <p className="mt-0.5 text-2xs text-ink-subtle">
                      Marked received {formatDateTime(line.received_at)}
                    </p>
                  )}
                  {line.notes && <p className="mt-0.5 text-xs text-ink-muted">{line.notes}</p>}
                </div>

                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    icon="upload"
                    onClick={() => setUploadFor(line)}
                    aria-label={`Upload the file for ${line.item_name}`}
                  >
                    File
                  </Button>
                  <Button
                    size="sm"
                    variant={line.status === "Received" ? "ghost" : "secondary"}
                    icon="check"
                    onClick={() => setTarget(line)}
                  >
                    {line.status === "Received" ? "Update" : "Mark received"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {target && (
        <ChecklistLineDialog
          instanceId={instance.id}
          line={target}
          onClose={() => setTarget(null)}
          onDone={onChanged}
        />
      )}

      <DocumentUploader
        open={Boolean(uploadFor)}
        onClose={() => setUploadFor(null)}
        itemId={item.id}
        instanceId={instance.id}
        itemLabel={`${item.item_code} · ${item.name} (${instance.cycle_label})`}
        lockItem
        defaultDocType="Supporting Document"
        onUploaded={() => onChanged()}
      />
    </>
  );
}

function ChecklistLineDialog({
  instanceId,
  line,
  onClose,
  onDone,
}: {
  instanceId: string;
  line: ChecklistLine;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<ChecklistStatus>(line.status);
  const [note, setNote] = useState(line.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api<{ id: string; status: string }>(`/instances/${instanceId}/checklist/${line.id}`, {
        method: "PATCH",
        json: { status, note: note.trim() || null },
      }),
    onSuccess: () => {
      toast.success("Checklist updated", `${line.item_name} is now ${status.toLowerCase()}.`);
      void queryClient.invalidateQueries({ queryKey: qk.instances.detail(instanceId) });
      invalidateRegister(queryClient);
      onDone();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.detail : "The checklist line could not be updated."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={line.item_name}
      description="Record whether this document has been received."
      size="sm"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            block
            className="sm:w-auto"
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Status">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={status}
              onChange={(event) => setStatus(event.target.value as ChecklistStatus)}
              options={[
                { value: "Pending", label: "Pending — not yet received" },
                { value: "Received", label: "Received" },
                { value: "Not Required", label: "Not required for this cycle" },
              ]}
            />
          )}
        </Field>

        <Field label="Note" hint="Optional; shown on the checklist line">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Original seen; photocopy filed."
            />
          )}
        </Field>

        <p className="text-2xs text-ink-subtle">
          The note is recorded against this line and shows on the checklist. A line cannot be linked
          to a particular uploaded file — use the File button beside it to attach the document
          itself.
        </p>

        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
