/**
 * Dialogs and side sheets.
 *
 * Both are built on the native `<dialog>` element, which gives focus trapping,
 * Escape-to-close, inert background content and correct screen-reader
 * semantics from the browser rather than from hand-rolled JavaScript. That is
 * both less code and more reliable than reimplementing it.
 *
 * On a phone a modal becomes a bottom sheet; on a tablet and up it is a
 * centred card. A drawer slides in from the right on desktop and rises from
 * the bottom on mobile, so the primary action is always under the thumb.
 */

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Set for a dialog the user must answer before continuing. */
  dismissible?: boolean;
  className?: string;
}

const WIDTHS = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
};

function useDialogBehaviour(open: boolean, onClose: () => void, dismissible: boolean) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Long dialogs must not scroll the page behind them on iOS.
      document.body.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Escape fires `cancel`; block it when the dialog is not dismissible.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      if (!dismissible) event.preventDefault();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [dismissible]);

  // A click on the backdrop (outside the panel) closes the dialog.
  const onBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (!dismissible) return;
    if (event.target === ref.current) onClose();
  };

  return { ref, onBackdropClick };
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  className,
}: DialogShellProps) {
  const { ref, onBackdropClick } = useDialogBehaviour(open, onClose, dismissible);

  return (
    // Clicking the backdrop is a pointer convenience, not the only way out:
    // Escape is handled natively on the `<dialog>` (see `useDialogBehaviour`)
    // and every dialog renders a Close button, so the keyboard path exists
    // without a second listener on the backdrop itself.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      aria-labelledby="dialog-title"
      className={cn(
        "m-0 max-h-none w-full bg-transparent p-0 backdrop:bg-ink/50 backdrop:backdrop-blur-[2px]",
        // Phone: anchored to the bottom as a sheet. Tablet and up: centred.
        "fixed inset-x-0 bottom-0 top-auto sm:inset-0 sm:m-auto",
        "sm:h-fit sm:max-h-[92vh]",
        WIDTHS[size],
        className,
      )}
    >
      <div className="flex max-h-[92vh] flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-[var(--shadow-overlay)] sm:rounded-[var(--radius-card)]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 id="dialog-title" className="text-lg leading-tight font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mt-1 -mr-1 rounded p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink"
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>

        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}

/** A side sheet for detail views that should not lose the list behind them. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "lg",
  className,
}: DialogShellProps) {
  const { ref, onBackdropClick } = useDialogBehaviour(open, onClose, true);

  return (
    // As for the centred dialog above: the backdrop click is a convenience,
    // and Escape plus the Close button are the keyboard paths.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      aria-labelledby="drawer-title"
      className={cn(
        "m-0 ml-auto h-full max-h-none w-full bg-transparent p-0 backdrop:bg-ink/50 backdrop:backdrop-blur-[2px]",
        "fixed inset-y-0 right-0",
        size === "xl" ? "sm:max-w-3xl" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-xl",
        className,
      )}
    >
      <div className="flex h-full flex-col overflow-hidden border-l border-line bg-surface shadow-[var(--shadow-overlay)]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 id="drawer-title" className="text-lg leading-tight font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mt-1 -mr-1 rounded p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>

        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-line bg-surface px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}

/**
 * Confirmation for anything irreversible.
 *
 * Archiving a statutory obligation or revoking a share link is not a thing to
 * do by accident, so the destructive action is never the default focus and the
 * consequence is spelled out in words.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button onClick={onClose} disabled={loading} className="sm:w-auto" block>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
            className="sm:w-auto"
            block
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            tone === "danger" ? "bg-rag-red-bg text-rag-red" : "bg-brand-50 text-brand-600",
          )}
        >
          <Icon name={tone === "danger" ? "alert" : "info"} size={18} />
        </span>
        <div className="text-sm text-ink-muted">{message}</div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </Modal>
  );
}
