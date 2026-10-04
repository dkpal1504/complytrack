/**
 * How each status, bucket and RAG colour is presented.
 *
 * The mapping lives here rather than in the components so that the register,
 * the dashboards, the charts and the exports all speak the same visual
 * language. Every status carries a label and an icon, never colour alone.
 */

import type { ComplianceBucket, DerivedStatus, ItemStatus, Rag } from "@/types/api";

export interface StatusStyle {
  label: string;
  /** Tailwind classes for a chip. */
  chip: string;
  /** A dot/bar colour usable in charts. */
  solid: string;
  /** A short icon name from the Icon component. */
  icon: string;
}

export const BUCKET_STYLES: Record<ComplianceBucket, StatusStyle> = {
  Complied: {
    label: "Complied",
    chip: "bg-rag-green-bg text-rag-green border-rag-green-border",
    solid: "var(--color-rag-green)",
    icon: "check",
  },
  "Under Process": {
    label: "Under Process",
    chip: "bg-status-under-process/10 text-status-under-process border-status-under-process/30",
    solid: "var(--color-status-under-process)",
    icon: "progress",
  },
  Pending: {
    label: "Pending",
    chip: "bg-rag-grey-bg text-rag-grey border-rag-grey-border",
    solid: "var(--color-rag-grey)",
    icon: "clock",
  },
  Overdue: {
    label: "Overdue",
    chip: "bg-rag-amber-bg text-rag-amber border-rag-amber-border",
    solid: "var(--color-rag-amber)",
    icon: "alert",
  },
  Expired: {
    label: "Expired",
    chip: "bg-rag-red-bg text-rag-red border-rag-red-border",
    solid: "var(--color-rag-red)",
    icon: "x",
  },
};

export const STATUS_STYLES: Record<ItemStatus, StatusStyle> = {
  Pending: {
    label: "Pending",
    chip: "bg-rag-grey-bg text-rag-grey border-rag-grey-border",
    solid: "var(--color-status-pending)",
    icon: "clock",
  },
  "Under Process": {
    label: "Under Process",
    chip: "bg-status-under-process/10 text-status-under-process border-status-under-process/30",
    solid: "var(--color-status-under-process)",
    icon: "progress",
  },
  Submitted: {
    label: "Submitted",
    chip: "bg-status-submitted/10 text-status-submitted border-status-submitted/30",
    solid: "var(--color-status-submitted)",
    icon: "send",
  },
  Renewed: {
    label: "Renewed",
    chip: "bg-rag-green-bg text-rag-green border-rag-green-border",
    solid: "var(--color-status-renewed)",
    icon: "check",
  },
  Closed: {
    label: "Closed",
    chip: "bg-rag-green-bg text-rag-green border-rag-green-border",
    solid: "var(--color-status-closed)",
    icon: "check",
  },
  "Query Raised": {
    label: "Query Raised",
    chip: "bg-rag-red-bg text-rag-red border-rag-red-border",
    solid: "var(--color-status-query)",
    icon: "alert",
  },
  "On Hold": {
    label: "On Hold",
    chip: "bg-rag-amber-bg text-rag-amber border-rag-amber-border",
    solid: "var(--color-status-on-hold)",
    icon: "pause",
  },
  "Not Applicable": {
    label: "Not Applicable",
    chip: "bg-rag-grey-bg text-rag-grey border-rag-grey-border",
    solid: "var(--color-rag-grey)",
    icon: "minus",
  },
};

const DERIVED_ICONS: Record<DerivedStatus, StatusStyle["icon"]> = {
  Valid: "check",
  Upcoming: "clock",
  "Due for Renewal": "clock",
  Expired: "x",
  Perpetual: "infinity",
  "Not Applicable": "minus",
};

export function derivedStyle(status: DerivedStatus): { label: string; icon: string } {
  return { label: status, icon: DERIVED_ICONS[status] ?? "clock" };
}

export const RAG_LABEL: Record<Rag, string> = {
  red: "Breach or expired",
  amber: "Due soon",
  green: "In good standing",
  grey: "Not applicable",
};

/** The RAG band a compliance index score falls into. */
export function indexRag(index: number): Rag {
  if (index >= 90) return "green";
  if (index >= 75) return "amber";
  return "red";
}

export const CRITICALITY_CHIP: Record<string, string> = {
  Critical: "bg-rag-red-bg text-rag-red border-rag-red-border",
  High: "bg-rag-amber-bg text-rag-amber border-rag-amber-border",
  Medium: "bg-status-under-process/10 text-status-under-process border-status-under-process/30",
  Low: "bg-rag-grey-bg text-rag-grey border-rag-grey-border",
};

/** Chart palette, in the order the stacked bars stack. */
export const CHART_SERIES: { key: ComplianceBucket; color: string }[] = [
  { key: "Complied", color: "var(--color-rag-green)" },
  { key: "Under Process", color: "var(--color-status-under-process)" },
  { key: "Pending", color: "var(--color-rag-grey)" },
  { key: "Overdue", color: "var(--color-rag-amber)" },
  { key: "Expired", color: "var(--color-rag-red)" },
];

/**
 * What a management KPI card counts, and therefore what it opens when clicked.
 *
 * The members are the API's own `drill` codes, spelled exactly as it sends them,
 * so a card's link can hand the value straight to the register without a
 * translation table that could drift. `due30` is a window rather than a bucket,
 * which is why it is not in `ComplianceBucket`.
 */
export const BUCKET_DRILLS = [
  "all",
  "Complied",
  "Pending",
  "Under Process",
  "Overdue",
  "Expired",
  "due30",
] as const;

export type BucketDrill = (typeof BUCKET_DRILLS)[number];

/** How each drill reads in a filter chip or a select. */
export const BUCKET_DRILL_LABEL: Record<string, string> = {
  all: "Everything in scope",
  due30: "Due in the next 30 days",
  ...Object.fromEntries(
    (Object.keys(BUCKET_STYLES) as ComplianceBucket[]).map((bucket) => [
      bucket,
      BUCKET_STYLES[bucket].label,
    ]),
  ),
};

/** The same list as select options, in the order the cards are laid out. */
export const BUCKET_DRILL_OPTIONS = BUCKET_DRILLS.map((value) => ({
  value,
  label: BUCKET_DRILL_LABEL[value],
}));

