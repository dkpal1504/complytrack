/**
 * The item's history (AT-02 / RT-08).
 *
 * One feed, assembled by the server from the audit log, comments, document
 * uploads, reminders and escalations — so the panel is a plain reader plus a
 * kind filter, not five separate fetches that could disagree.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/Feedback";
import { Icon, type IconName } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";
import { formatDateTime, formatRelative, titleCase } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { TimelineEntry } from "@/features/register/api-types";

const KIND_GROUPS: { key: string; label: string; match: (kind: string) => boolean }[] = [
  { key: "all", label: "Everything", match: () => true },
  {
    key: "status",
    label: "Workflow",
    match: (kind) =>
      ["transition", "status", "verify", "close", "submit", "renew", "archive", "restore", "create", "update"].some(
        (needle) => kind.includes(needle),
      ),
  },
  { key: "document", label: "Documents", match: (kind) => kind === "document" || kind.includes("upload") },
  { key: "comment", label: "Comments", match: (kind) => kind === "comment" },
  {
    key: "reminder",
    label: "Reminders",
    match: (kind) => kind.includes("remind") || kind.includes("escalat"),
  },
];

const SEVERITY_ICON: Record<string, IconName> = {
  critical: "shield-alert",
  warning: "alert",
  info: "circle-dot",
  success: "check-circle",
};

export interface TimelinePanelProps {
  instanceId: string;
}

export function TimelinePanel({ instanceId }: TimelinePanelProps) {
  const [group, setGroup] = useState("all");

  const timeline = useQuery({
    queryKey: qk.instances.timeline(instanceId),
    queryFn: () => api<TimelineEntry[]>(`/instances/${instanceId}/timeline`),
    retry: false,
  });

  const entries = useMemo(() => {
    const matcher = KIND_GROUPS.find((item) => item.key === group)?.match ?? (() => true);
    return [...(timeline.data ?? [])]
      .filter((entry) => matcher(entry.kind))
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [timeline.data, group]);

  if (timeline.isPending) return <SkeletonRows rows={6} />;
  if (timeline.isError) {
    return (
      <ErrorState
        error={timeline.error}
        title="The history could not be loaded"
        onRetry={() => void timeline.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="scroll-thin flex gap-1.5 overflow-x-auto" role="group" aria-label="Filter history">
        {KIND_GROUPS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={group === item.key}
            onClick={() => setGroup(item.key)}
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors",
              group === item.key
                ? "border-brand-300 bg-brand-600 text-white"
                : "border-line bg-surface-muted text-ink-muted hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="history"
          title="Nothing recorded yet"
          description="Status changes, comments, uploads and reminders all appear here as they happen."
        />
      ) : (
        <Card className="p-4 sm:p-5">
          <ol className="relative space-y-5 border-l border-line pl-5">
            {entries.map((entry, index) => (
              <li key={`${entry.ts}-${index}`} className="relative">
                <span
                  className={cn(
                    "absolute -left-[27px] flex size-4 items-center justify-center rounded-full border bg-surface",
                    entry.severity === "critical"
                      ? "border-rag-red-border text-rag-red"
                      : entry.severity === "warning"
                        ? "border-rag-amber-border text-rag-amber"
                        : entry.severity === "success"
                          ? "border-rag-green-border text-rag-green"
                          : "border-line-strong text-ink-subtle",
                  )}
                >
                  <Icon name={SEVERITY_ICON[entry.severity] ?? "circle-dot"} size={9} />
                </span>

                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-sm font-medium text-ink">{entry.title}</p>
                  <time
                    dateTime={entry.ts}
                    className="text-2xs text-ink-subtle"
                    title={formatDateTime(entry.ts)}
                  >
                    {formatRelative(entry.ts)}
                  </time>
                </div>

                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-ink-muted">
                  <span className="rounded-full bg-surface-muted px-1.5 py-0.5 font-medium">
                    {titleCase(entry.kind)}
                  </span>
                  {entry.actor && <span>{entry.actor}</span>}
                  <span>{formatDateTime(entry.ts)}</span>
                </p>

                {entry.detail && (
                  <p className="mt-1 text-xs whitespace-pre-line text-ink-muted">{entry.detail}</p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
