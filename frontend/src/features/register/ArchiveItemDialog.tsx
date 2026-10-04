/**
 * Archive and restore, with the reason the API insists on.
 *
 * `POST /items/{id}/archive` and `/restore` both take a reason of at least
 * three characters, and that reason lands in the audit trail — so the dialog
 * treats it as the point of the exercise rather than an afterthought.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Feedback";
import { Field, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { Icon } from "@/components/ui/Icon";
import { ApiError, api } from "@/lib/api";
import { invalidateRegister, queryClient } from "@/lib/query";

export interface ArchiveItemDialogProps {
  open: boolean;
  itemId: string;
  itemLabel: string;
  mode: "archive" | "restore";
  onClose: () => void;
  onDone?: () => void;
}

export function ArchiveItemDialog({
  open,
  itemId,
  itemLabel,
  mode,
  onClose,
  onDone,
}: ArchiveItemDialogProps) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const archiving = mode === "archive";

  const close = () => {
    if (mutation.isPending) return;
    setReason("");
    setError(null);
    onClose();
  };

  const mutation = useMutation({
    mutationFn: () =>
      api<{ detail: string }>(`/items/${itemId}/${mode}`, {
        method: "POST",
        json: { reason: reason.trim() },
      }),
    onSuccess: (data) => {
      toast.success(archiving ? "Obligation archived" : "Obligation restored", data.detail);
      invalidateRegister(queryClient);
      onDone?.();
      close();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.detail : "The change could not be saved."),
  });

  const canSubmit = reason.trim().length >= 3 && !mutation.isPending;

  return (
    <Modal
      open={open}
      onClose={close}
      title={archiving ? "Archive this obligation?" : "Restore this obligation?"}
      size="sm"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button onClick={close} disabled={mutation.isPending} block className="sm:w-auto">
            Cancel
          </Button>
          <Button
            variant={archiving ? "danger" : "primary"}
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            loading={mutation.isPending}
            block
            className="sm:w-auto"
          >
            {archiving ? "Archive" : "Restore"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
              archiving ? "bg-rag-red-bg text-rag-red" : "bg-brand-50 text-brand-600"
            }`}
          >
            <Icon name={archiving ? "alert" : "restore"} size={18} />
          </span>
          <p className="text-sm text-ink-muted">
            {archiving ? (
              <>
                <span className="font-medium text-ink">{itemLabel}</span> will be hidden from the
                register, the dashboards and the reminders. Nothing is deleted — it stays on file
                for audit and can be restored.
              </>
            ) : (
              <>
                <span className="font-medium text-ink">{itemLabel}</span> will return to the
                register and to the reminder engine.
              </>
            )}
          </p>
        </div>

        <Field label="Reason" required hint="Recorded on the audit trail (at least 3 characters)">
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder={
                archiving
                  ? "e.g. Unit decommissioned; obligation no longer applicable."
                  : "e.g. Unit restarted; CTO renewed."
              }
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
