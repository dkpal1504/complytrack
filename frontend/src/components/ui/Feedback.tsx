/**
 * Loading, empty, error and confirmation feedback.
 *
 * The empty and error states are deliberately specific: "No obligations match
 * these filters — try widening the date range" tells a compliance officer what
 * to do next, where "No data" does not.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

/* ------------------------------ Toasts ------------------------------ */

type ToastTone = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** An action the user can take straight from the toast, e.g. "Undo". */
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  push: (toast: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}

const TONE_STYLE: Record<ToastTone, { icon: IconName; className: string }> = {
  success: { icon: "check-circle", className: "border-rag-green-border bg-rag-green-bg text-rag-green" },
  error: { icon: "alert-circle", className: "border-rag-red-border bg-rag-red-bg text-rag-red" },
  warning: { icon: "alert", className: "border-rag-amber-border bg-rag-amber-bg text-rag-amber" },
  info: { icon: "info", className: "border-line-strong bg-surface text-ink" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    setToasts((current) => [...current.slice(-3), { ...toast, id: Date.now() + Math.random() }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, description) => push({ tone: "success", title, description }),
      error: (title, description) => push({ tone: "error", title, description }),
      info: (title, description) => push({ tone: "info", title, description }),
    }),
    [push],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Announced politely so a screen-reader user hears the outcome without
          losing their place in the form they just submitted. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-96"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const style = TONE_STYLE[toast.tone];

  useEffect(() => {
    if (toast.action) return; // Never auto-dismiss something with an Undo on it.
    const timer = setTimeout(onDismiss, toast.tone === "error" ? 9000 : 5000);
    return () => clearTimeout(timer);
  }, [onDismiss, toast.action, toast.tone]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-[var(--radius-card)] border px-3.5 py-3 shadow-[var(--shadow-raised)]",
        style.className,
      )}
    >
      <Icon name={style.icon} size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-xs opacity-90">{toast.description}</p>}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              onDismiss();
            }}
            className="mt-2 text-xs font-semibold underline underline-offset-2"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mt-1 -mr-1 rounded p-1 opacity-60 hover:opacity-100"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/* ---------------------------- Loading states ---------------------------- */

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-line-strong border-t-brand-600",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

/** A block-level skeleton, used while a panel's first payload arrives. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-[var(--radius-control)] bg-surface-muted", className)}
    />
  );
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading records">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)} aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-28 w-full" />
      ))}
    </div>
  );
}

/* ------------------------- Empty, error and denial ------------------------- */

export function EmptyState({
  icon = "search",
  title,
  description,
  action,
  className,
}: {
  icon?: IconName;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-surface-muted text-ink-subtle">
        <Icon name={icon} size={22} />
      </span>
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Renders any thrown error as something a human can act on. */
export function ErrorState({
  error,
  onRetry,
  className,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  title?: string;
}) {
  const apiError = error instanceof ApiError ? error : null;

  // A permission failure is not a fault — say so plainly instead of showing a
  // retry button that can never succeed.
  if (apiError?.isForbidden) {
    return (
      <EmptyState
        icon="lock"
        title="You do not have access to this"
        description="Your role does not cover this screen. If you need it, ask an administrator to review your access."
        className={className}
      />
    );
  }

  const message =
    apiError?.detail ??
    (error instanceof Error ? error.message : "Something went wrong while loading this view.");

  return (
    <EmptyState
      icon="alert-circle"
      title={title ?? (apiError?.isNotFound ? "Not found" : "Could not load this view")}
      description={message}
      action={
        onRetry ? (
          <Button icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
      className={className}
    />
  );
}

/* ------------------------------ Progress ------------------------------ */

export function ProgressBar({
  value,
  max = 100,
  tone = "brand",
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: "brand" | "green" | "amber" | "red";
  label?: string;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const tones = {
    brand: "bg-brand-600",
    green: "bg-rag-green",
    amber: "bg-rag-amber",
    red: "bg-rag-red",
  };
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-muted", className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", tones[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** A small inline "x of y done" meter, for checklists. */
export function Meter({
  done,
  total,
  waived = 0,
  className,
}: {
  done: number;
  total: number;
  /** Lines that this cycle does not need — `Not Required` on the checklist. */
  waived?: number;
  className?: string;
}) {
  // A line the authority does not want this time is not outstanding work, so
  // it must not hold the meter below complete. The API already counts this
  // way — its checklist `percent` ignores `Not Required` lines — and a meter
  // reading "3/4, amber" beside a figure reading "100%" is the same fact told
  // two ways. The waived lines are named instead of counted in.
  const applicable = Math.max(total - waived, 0);
  const tone = done >= applicable ? "green" : done === 0 ? "red" : "amber";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ProgressBar
        value={done}
        max={Math.max(applicable, 1)}
        tone={tone}
        label={`${done} of ${applicable} ready`}
        className="w-20"
      />
      <span className="tabular text-2xs text-ink-muted">
        {done}/{applicable}
      </span>
      {waived > 0 && (
        <span className="text-2xs text-ink-subtle">· {waived} not required</span>
      )}
    </div>
  );
}

/* --------------------------- Full-page states --------------------------- */

export function PageSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-ink-muted">
      <Spinner size={28} />
      <p className="text-sm">{label}…</p>
    </div>
  );
}

/** A retry-able destructive confirmation result. */
export function DangerButton(props: ButtonProps) {
  return <Button variant="danger" {...props} />;
}
