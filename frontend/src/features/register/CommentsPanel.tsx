/**
 * The conversation on an obligation (RT-07).
 *
 * The API can post a comment but has no endpoint that lists them on their own —
 * they arrive inside the item's timeline feed, tagged `kind: "comment"`. So the
 * thread here is that slice of the timeline, read oldest-first, which keeps it
 * consistent with the History tab rather than a second, possibly stale, source.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonRows, useToast } from "@/components/ui/Feedback";
import { Field, Select, Textarea } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { ApiError, api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { formatDateTime, formatRelative, initials } from "@/lib/format";
import { useAuth } from "@/features/auth/auth-context";
import { toOptions, useLookups } from "@/features/org/useReference";
import type { TimelineEntry } from "@/features/register/api-types";

export interface CommentsPanelProps {
  instanceId: string;
  itemLabel?: string;
}

export function CommentsPanel({ instanceId, itemLabel }: CommentsPanelProps) {
  const toast = useToast();
  const { can } = useAuth();
  const lookups = useLookups();

  const [body, setBody] = useState("");
  const [mention, setMention] = useState("");
  const [error, setError] = useState<string | null>(null);

  const timeline = useQuery({
    queryKey: qk.instances.timeline(instanceId),
    queryFn: () => api<TimelineEntry[]>(`/instances/${instanceId}/timeline`),
    retry: false,
  });

  const thread = useMemo(
    () =>
      (timeline.data ?? [])
        .filter((entry) => entry.kind === "comment")
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()),
    [timeline.data],
  );

  const post = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/instances/${instanceId}/comments`, {
        method: "POST",
        json: {
          body: body.trim(),
          mentions: mention ? [mention] : [],
          kind: "comment",
        },
      }),
    onSuccess: () => {
      setBody("");
      setMention("");
      setError(null);
      toast.success("Comment added", mention ? "The person you named has been notified." : undefined);
      void queryClient.invalidateQueries({ queryKey: qk.instances.timeline(instanceId) });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.detail : "The comment could not be posted."),
  });

  // Commenting is a write against the item, which needs the same permission as
  // any other update. Read-only roles see the thread and are told why the box
  // is not there.
  const canComment = can("update_assigned") || can("manage_items");

  return (
    <div className="space-y-4">
      {canComment && (
        <Card className="p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-ink">
            Add a comment{itemLabel ? ` on ${itemLabel}` : ""}
          </h3>
          <div className="mt-3 space-y-3">
            <Field label="Comment" required hint="Visible to everyone who can see this obligation">
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  rows={3}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="e.g. Fee challan collected; acknowledging receipt from the PCB portal."
                />
              )}
            </Field>

            <Field label="Notify" hint="Optional — sends a mention to this person">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={mention}
                  onChange={(event) => setMention(event.target.value)}
                  placeholder="Nobody in particular"
                  options={toOptions(lookups.data?.users)}
                />
              )}
            </Field>

            {error && (
              <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                variant="primary"
                icon="send"
                onClick={() => post.mutate()}
                disabled={!body.trim() || post.isPending}
                loading={post.isPending}
              >
                Post comment
              </Button>
            </div>
          </div>
        </Card>
      )}

      {!canComment && (
        <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5 text-xs text-ink-muted">
          <Icon name="lock" size={15} className="mt-0.5 shrink-0" />
          <span>
            Your role can read this conversation but not add to it. Commenting needs update rights
            on the obligation.
          </span>
        </p>
      )}

      {timeline.isPending ? (
        <SkeletonRows rows={3} />
      ) : timeline.isError ? (
        <ErrorState
          error={timeline.error}
          title="The conversation could not be loaded"
          onRetry={() => void timeline.refetch()}
        />
      ) : thread.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="No comments yet"
          description="Notes left here are visible to everyone who can see the obligation."
        />
      ) : (
        <ul className="space-y-3">
          {thread.map((entry, index) => (
            <li key={`${entry.ts}-${index}`}>
              <Card className="p-3.5">
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                    {initials(entry.title.replace(/ commented$/, "") || "?")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="text-sm font-medium text-ink">
                        {entry.title.replace(/ commented$/, "")}
                      </p>
                      <time
                        dateTime={entry.ts}
                        title={formatDateTime(entry.ts)}
                        className="text-2xs text-ink-subtle"
                      >
                        {formatRelative(entry.ts)}
                      </time>
                    </div>
                    {entry.actor && <p className="text-2xs text-ink-subtle">{entry.actor}</p>}
                    <p className="mt-1.5 text-sm whitespace-pre-line text-ink">{entry.detail}</p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
