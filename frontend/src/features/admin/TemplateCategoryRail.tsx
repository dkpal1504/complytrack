/**
 * The category rail beside the template table.
 *
 * Categories are a two-level tree (parents with children); the counts live on
 * the parent, because seeded templates attach to a parent category. Selecting a
 * node filters the library to exactly that category id.
 */

import { Card } from "@/components/ui/Card";
import { CountBadge } from "@/components/ui/Chip";
import { ErrorState, SkeletonRows } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { TemplateCategoryNode } from "@/features/admin/admin-types";

export function TemplateCategoryRail({
  nodes,
  selected,
  onSelect,
  loading,
  error,
  onRetry,
}: {
  nodes: TemplateCategoryNode[];
  selected: string;
  onSelect: (id: string) => void;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Categories</h2>
        <p className="mt-0.5 text-2xs text-ink-subtle">
          Filter the library by the part of the business it applies to.
        </p>
      </div>
      <div className="p-2">
        {error ? (
          <ErrorState error={error} onRetry={onRetry} className="px-2 py-6" />
        ) : loading ? (
          <SkeletonRows rows={6} className="p-2" />
        ) : (
          <nav aria-label="Template categories">
            <ul className="space-y-0.5">
              <li>
                <CategoryButton
                  label="All categories"
                  count={nodes.reduce((sum, node) => sum + node.template_count, 0)}
                  active={selected === ""}
                  onClick={() => onSelect("")}
                />
              </li>
              {nodes.map((node) => (
                <li key={node.id}>
                  <CategoryButton
                    label={node.name}
                    colour={node.colour}
                    count={node.template_count}
                    active={selected === node.id}
                    onClick={() => onSelect(node.id)}
                  />
                  {node.children && node.children.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5">
                      {node.children.map((child) => (
                        <li key={child.id}>
                          <CategoryButton
                            label={child.name}
                            colour={child.colour}
                            count={child.template_count}
                            active={selected === child.id}
                            onClick={() => onSelect(child.id)}
                            indent
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </Card>
  );
}

function CategoryButton({
  label,
  count,
  active,
  onClick,
  colour,
  indent = false,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  colour?: string | null;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-sm transition-colors",
        indent && "pl-5 text-xs",
        active ? "bg-brand-600 text-white" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
      )}
    >
      {colour ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: colour }}
        />
      ) : (
        <Icon name="columns" size={13} className="shrink-0 opacity-70" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <CountBadge value={count} className={active ? "bg-white/20 text-white" : undefined} />
    </button>
  );
}
