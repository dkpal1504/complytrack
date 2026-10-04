/**
 * Tabs and segmented controls.
 *
 * Both are real ARIA tab lists with arrow-key navigation, so a keyboard user
 * moves between panels the way the role expects. On a narrow screen the tab
 * strip scrolls horizontally rather than wrapping into a ragged block.
 */

import { Link, useLocation } from "react-router-dom";

import { CountBadge } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: IconName;
  tone?: "neutral" | "danger" | "warning";
}

export function Tabs({
  items,
  value,
  onChange,
  className,
  size = "md",
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = (index + offset + items.length) % items.length;
    onChange(items[next].id);
    // Move focus with the selection, as the tab pattern requires.
    const list = event.currentTarget.parentElement;
    (list?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div
      role="tablist"
      className={cn(
        "scroll-thin flex gap-1 overflow-x-auto border-b border-line",
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "relative -mb-px flex shrink-0 items-center gap-2 border-b-2 font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "px-3 py-2 text-xs" : "px-3.5 py-2.5 text-sm",
              selected
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {item.icon && <Icon name={item.icon} size={15} />}
            {item.label}
            {item.count !== undefined && (
              <CountBadge value={item.count} tone={item.tone ?? "neutral"} />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Tabs that are addresses, not state — each panel is its own URL. */
export function TabLinks({
  items,
  className,
}: {
  items: { to: string; label: string; count?: number; tone?: "neutral" | "danger" | "warning" }[];
  className?: string;
}) {
  const { pathname } = useLocation();
  return (
    <nav className={cn("scroll-thin flex gap-1 overflow-x-auto border-b border-line", className)}>
      {items.map((item) => {
        // A tab stays lit on its own child routes, so a detail page still
        // shows which section the user is in.
        const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <CountBadge value={item.count} tone={item.tone ?? "neutral"} />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 rounded-[var(--radius-control)] border border-line bg-surface-muted p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            {option.icon && <Icon name={option.icon} size={14} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Breadcrumbs({
  items,
  className,
}: {
  items: { label: string; to?: string }[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <Icon name="chevron-right" size={13} className="shrink-0 text-ink-subtle" />}
              {item.to && !last ? (
                <Link to={item.to} className="truncate hover:text-ink hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={cn("truncate", last && "font-medium text-ink")} aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
