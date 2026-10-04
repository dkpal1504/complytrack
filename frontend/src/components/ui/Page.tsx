/**
 * Page furniture: the header every screen shares, the KPI tiles the dashboards
 * are built from, and the filter toolbar the register lives in.
 */

import { Link } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { CountBadge } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  tabs,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("page-header", className)}>
      <div className="px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
        {breadcrumbs && <div className="mb-2">{breadcrumbs}</div>}
        {/*
          The title and the actions stack until `lg`, not `sm`.

          A screen with four actions — the register has export, template, import
          and new — presents them on one line at 640px, and with `shrink-0` they
          take the whole row: the title is squeezed to a zero-width column and
          its text wraps invisibly, while the action row itself overflows its
          container by a few pixels. Side by side there is only room from `lg`.
        */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight text-ink">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 sm:justify-end lg:shrink-0">
              {actions}
            </div>
          )}
        </div>
      </div>
      {tabs}
    </header>
  );
}

/**
 * A KPI tile.
 *
 * The value is the loudest thing on the tile, because on a management
 * dashboard the number is the message; the label and the trend support it.
 *
 * `href` is how a KPI drills into the list behind it (PRD §7, AC-5). A real
 * link rather than a click handler: the target is a filtered register, which
 * is addressable, so it can be opened in a new tab like anything else on the
 * web — and a screen reader announces it as a link that goes somewhere.
 */
export function StatTile({
  label,
  value,
  unit,
  icon,
  tone = "neutral",
  hint,
  trend,
  href,
  onClick,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  icon?: IconName;
  tone?: "neutral" | "good" | "warning" | "critical" | "brand";
  hint?: React.ReactNode;
  trend?: { value: number; goodDirection?: "up" | "down" };
  /** Where the tile drills to. Announced, and openable in a new tab. */
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const TONES = {
    neutral: "text-ink",
    good: "text-rag-green",
    warning: "text-rag-amber",
    critical: "text-rag-red",
    brand: "text-brand-600",
  } as const;

  const toneForTrend = (() => {
    if (!trend) return "text-ink-subtle";
    const up = trend.value > 0;
    const good = trend.goodDirection === "down" ? !up : up;
    return good ? "text-rag-green" : "text-rag-red";
  })();

  const content = (
    <Card
      className={cn(
        "h-full p-4 transition-shadow",
        (onClick || href) && "cursor-pointer hover:shadow-[var(--shadow-raised)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-ink-muted">{label}</p>
        {icon && (
          <span className={cn("shrink-0", TONES[tone])}>
            <Icon name={icon} size={17} />
          </span>
        )}
      </div>
      <p className={cn("tabular mt-2 text-3xl leading-none font-semibold", TONES[tone])}>
        {value}
        {unit && <span className="ml-1 text-base font-medium text-ink-subtle">{unit}</span>}
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-2xs">
        {trend && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", toneForTrend)}>
            <Icon name={trend.value >= 0 ? "trend-up" : "trend-down"} size={12} />
            {Math.abs(trend.value)}%
          </span>
        )}
        {hint && <span className="text-ink-subtle">{hint}</span>}
      </div>
    </Card>
  );

  if (href) {
    return (
      <Link
        to={href}
        // The number alone would be announced as "4, link"; the label says what
        // the four are, which is the whole point of drilling in.
        aria-label={`${label}: ${String(value)}. Open in the register`}
        className="block rounded-[var(--radius-card)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        {content}
      </Link>
    );
  }

  if (!onClick) return content;
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-[var(--radius-card)] text-left"
    >
      {content}
    </button>
  );
}

/** The strip of filters above a table or chart. */
export function Toolbar({
  children,
  className,
  label = "Filters",
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex flex-col gap-2 border-b border-line bg-surface px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A labelled count used beside section headings. */
export function ResultCount({
  shown,
  total,
  noun = "obligation",
  className,
}: {
  shown: number;
  total: number;
  noun?: string;
  className?: string;
}) {
  const plural = total === 1 ? noun : `${noun}s`;
  return (
    <p className={cn("text-xs text-ink-muted", className)} aria-live="polite">
      Showing <span className="tabular font-semibold text-ink">{shown}</span> of{" "}
      <span className="tabular font-semibold text-ink">{total}</span> {plural}
    </p>
  );
}

/** A titled block used to group related fields on a detail page. */
export function Panel({
  title,
  icon,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  icon?: IconName;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {icon && <Icon name={icon} size={16} className="text-ink-muted" />}
          {title}
        </h3>
        {actions}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </Card>
  );
}

/** A definition-list grid, used for the item detail summary. */
export function DetailGrid({
  children,
  columns = 3,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-5 gap-y-4",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </dl>
  );
}

/** A section title with an optional count, for dashboards. */
export function SectionTitle({
  title,
  count,
  description,
  actions,
  className,
}: {
  title: string;
  count?: number;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-2", className)}>
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          {title}
          {count !== undefined && <CountBadge value={count} />}
        </h2>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
