/**
 * Password hand-over.
 *
 * A reset issues a temporary password that is shown exactly once: the server
 * stores only its hash, so if the dialog is closed without copying, the
 * administrator must reset again. That is deliberate — it is why the warning is
 * loud and the copy button is the primary action.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog, Modal } from "@/components/ui/Overlay";
import { api, ApiError } from "@/lib/api";
import { invalidateAdmin } from "@/lib/query";
import type { UserSummary } from "@/types/api";

interface ResetResponse {
  temporary_password: string | null;
  detail: string;
}

/** Asks for confirmation, then shows the new password once. */
export function ResetPasswordDialog({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: UserSummary | null;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const mutation = useMutation({
    mutationFn: (userId: string) =>
      api<ResetResponse>(`/users/${userId}/reset-password`, { method: "POST", json: {} }),
    onSuccess: (result: ResetResponse) => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      invalidateAdmin(queryClient);
      if (result.temporary_password) {
        setIssued({ email: user?.email ?? "", password: result.temporary_password });
      } else {
        toast.success("Password reset", "The new password has been set.");
        onClose();
      }
    },
    onError: (error) => {
      toast.error(
        "Could not reset the password",
        error instanceof ApiError ? error.detail : undefined,
      );
    },
  });

  // Clear the issued password as soon as the dialog is dismissed, so it does
  // not sit in memory behind the next account the administrator opens.
  useEffect(() => {
    if (!open) setIssued(null);
  }, [open]);

  if (issued) {
    return (
      <TemporaryPasswordDialog
        open={open}
        onClose={onClose}
        email={issued.email}
        password={issued.password}
      />
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => user && mutation.mutate(user.id)}
      loading={mutation.isPending}
      tone="primary"
      title="Reset this password?"
      confirmLabel="Generate temporary password"
      message={
        <>
          <p>
            A new temporary password will be generated for{" "}
            <span className="font-medium text-ink">{user?.name ?? "this account"}</span>.
          </p>
          <p className="mt-2">
            It is shown once and cannot be retrieved later. The user must change it at next sign-in.
          </p>
        </>
      }
    />
  );
}

/** Shows a temporary password once, with a copy button and a blunt warning. */
export function TemporaryPasswordDialog({
  open,
  onClose,
  email,
  password,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
  password: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast.success("Password copied to the clipboard.");
    } catch {
      toast.error(
        "Could not copy automatically",
        "Select the password and copy it manually before closing.",
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Temporary password"
      description={`Hand this to ${email || "the user"} through a secure channel.`}
      footer={
        <>
          <Button onClick={copy} icon="copy" className="sm:w-auto" block>
            {copied ? "Copied" : "Copy password"}
          </Button>
          <Button variant="primary" onClick={onClose} className="sm:w-auto" block>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p
          role="status"
          className="tabular rounded-[var(--radius-control)] border border-line-strong bg-surface-muted px-3 py-3 text-center font-mono text-lg font-semibold tracking-wider text-ink select-all"
        >
          {password}
        </p>
        <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-amber-border bg-rag-amber-bg px-3 py-2.5 text-xs text-rag-amber">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          <span>
            This password is shown once and is not stored in a readable form. If you lose it, you
            will have to reset the password again. The user is asked to change it when they sign in.
          </span>
        </p>
      </div>
    </Modal>
  );
}
