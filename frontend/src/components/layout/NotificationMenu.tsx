/**
 * The notification bell.
 *
 * New reminders and escalations arrive here. The unread count is polled rather
 * than pushed, because the service worker only needs the Push API for alerts
 * sent while the app is closed.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/ui/Feedback";
import { Icon, type IconName } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { qk } from "@/lib/query";
import type { Notification } from "@/types/api";

interface NotificationPage {
  items: Notification[];
  unread: number;
  total: number;
}

const SEVERITY_ICON: Record<string, IconName> = {
  danger: "alert-circle",
  warning: "alert",
  success: "check-circle",
  info: "info",
};

export function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.notifications.list({ unread_only: false }),
    queryFn: () => api<NotificationPage>("/notifications?page_size=20"),
    refetchInterval: 60_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const markRead = useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: invalidate,
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = query.data?.unread ?? 0;
  const items = query.data?.items ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] text-ink-muted hover:bg-surface-muted hover:text-ink"
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-rag-red px-1 text-[10px] leading-4 font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-overlay)]"
        >
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <p className="text-sm font-semibold text-ink">
              Notifications
              {unread > 0 && <span className="ml-1.5 text-xs font-normal text-ink-muted">{unread} new</span>}
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="scroll-thin max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <EmptyState
                icon="bell"
                title="Nothing new"
                description="Reminders and escalations addressed to you will appear here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.link ?? "/notifications"}
                      onClick={() => {
                        setOpen(false);
                        if (!item.is_read) markRead.mutate(item.id);
                      }}
                      className={cn(
                        "flex gap-2.5 px-3.5 py-3 hover:bg-surface-muted",
                        !item.is_read && "bg-brand-50/50",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 shrink-0",
                          item.severity === "danger" && "text-rag-red",
                          item.severity === "warning" && "text-rag-amber",
                          item.severity === "success" && "text-rag-green",
                          !["danger", "warning", "success"].includes(item.severity) && "text-ink-subtle",
                        )}
                      >
                        <Icon name={SEVERITY_ICON[item.severity] ?? "info"} size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-ink">{item.title}</span>
                        {item.body && (
                          <span className="mt-0.5 block line-clamp-2 text-2xs text-ink-muted">
                            {item.body}
                          </span>
                        )}
                        <span className="mt-1 block text-2xs text-ink-subtle">
                          {formatRelative(item.created_at)}
                        </span>
                      </span>
                      {!item.is_read && (
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-hidden />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-line px-3.5 py-2.5">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
            >
              View all notifications
              <Icon name="arrow-right" size={13} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
