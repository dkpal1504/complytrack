/**
 * Status chips.
 *
 * Every chip pairs its colour with a word and a glyph. RAG colour alone is not
 * an accessible signal — around 8% of men cannot reliably tell the red and
 * green chips apart — so the label is the primary carrier of meaning and the
 * colour reinforces it.
 */

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import {
  BUCKET_STYLES,
  CRITICALITY_CHIP,
  RAG_LABEL,
  STATUS_STYLES,
  derivedStyle,
} from "@/lib/status";
import type {
  ComplianceBucket,
  Criticality,
  DerivedStatus,
  ItemStatus,
  Rag,
} from "@/types/api";

const BASE =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium whitespace-nowrap";

export function Chip({
  children,
  className,
  icon,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  icon?: IconName;
  title?: string;
}) {
  return (
    <span className={cn(BASE, "bg-surface-muted text-ink-muted border-line", className)} title={title}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/** The workflow state (PRD §8). */
export function StatusChip({
  status,
  className,
  showIcon = true,
}: {
  status: ItemStatus | string;
  className?: string;
  showIcon?: boolean;
}) {
  const style = STATUS_STYLES[status as ItemStatus];
  if (!style) return <Chip className={className}>{status}</Chip>;
  return (
    <span className={cn(BASE, style.chip, className)}>
      {showIcon && <Icon name={style.icon} size={12} />}
      {style.label}
    </span>
  );
}

/** The derived, human-facing status (requirement RT-05). */
export function DerivedStatusChip({
  status,
  className,
}: {
  status: DerivedStatus | string;
  className?: string;
}) {
  const { label, icon } = derivedStyle(status as DerivedStatus);
  return (
    <span className={cn(BASE, "bg-surface-muted text-ink-muted border-line", className)}>
      <Icon name={icon} size={12} />
      {label}
    </span>
  );
}

/** The dashboard bucket (business rule 1). */
export function BucketChip({
  bucket,
  className,
}: {
  bucket: ComplianceBucket | string | null;
  className?: string;
}) {
  if (!bucket) return <Chip className={className}>Not Applicable</Chip>;
  const style = BUCKET_STYLES[bucket as ComplianceBucket];
  if (!style) return <Chip className={className}>{bucket}</Chip>;
  return (
    <span className={cn(BASE, style.chip, className)}>
      <Icon name={style.icon} size={12} />
      {style.label}
    </span>
  );
}

/** A bare RAG dot, for dense table rows where the column header carries meaning. */
export function RagDot({ rag, className }: { rag: Rag; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: `var(--color-rag-${rag})` }}
      title={RAG_LABEL[rag]}
      role="img"
      aria-label={RAG_LABEL[rag]}
    />
  );
}

export function CriticalityChip({
  criticality,
  className,
}: {
  criticality: Criticality | string;
  className?: string;
}) {
  return (
    <span className={cn(BASE, CRITICALITY_CHIP[criticality] ?? CRITICALITY_CHIP.Low, className)}>
      {criticality}
    </span>
  );
}

/** A neutral counter, for tab labels and list headers. */
export function CountBadge({
  value,
  className,
  tone = "neutral",
}: {
  value: number;
  className?: string;
  tone?: "neutral" | "danger" | "warning";
}) {
  const tones = {
    neutral: "bg-surface-muted text-ink-muted",
    danger: "bg-rag-red-bg text-rag-red",
    warning: "bg-rag-amber-bg text-rag-amber",
  };
  return (
    <span
      className={cn(
        "tabular inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-2xs font-semibold",
        tones[tone],
        className,
      )}
    >
      {value > 999 ? "999+" : value}
    </span>
  );
}
