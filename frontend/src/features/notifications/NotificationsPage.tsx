/**
 * The notification centre (PRD §7.5, screen 6).
 *
 * Everything the reminder engine has said to this user, newest first. The feed
 * is the in-app half of a reminder that also went out by e-mail; a push device
 * can be registered here so the next one arrives on the phone.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonRows, useToast } from "@/components/ui/Feedback";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tabs, type TabItem } from "@/components/ui/Nav";
import { PageHeader } from "@/components/ui/Page";
import { Pagination } from "@/components/ui/Table";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useUrlFilters } from "@/lib/hooks";
import { qk } from "@/lib/query";

/** The live feed reports `read_at`, not the `is_read` flag the shared type names. */
interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: string;
  category: string;
  read_at: string | null;
  created_at: string;
}

interface NotificationFeed {
  items: NotificationRow[];
  unread: number;
  total: number;
}

const SEVERITY_ICON: Record<string, IconName> = {
  danger: "alert-circle",
  warning: "alert",
  success: "check-circle",
  info: "info",
};

const SEVERITY_STYLE: Record<string, string> = {
  danger: "bg-rag-red-bg text-rag-red border-rag-red-border",
  warning: "bg-rag-amber-bg text-rag-amber border-rag-amber-border",
  success: "bg-rag-green-bg text-rag-green border-rag-green-border",
  info: "bg-surface-muted text-ink-muted border-line",
};

/** Push needs a service worker, the Push API, a permission prompt and a key. */
function pushAvailability() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { supported: false, reason: "Push notifications are only available in a browser." };
  }
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "This browser does not support service workers." };
  }
  if (!("PushManager" in window) || !("Notification" in window)) {
    return { supported: false, reason: "This browser does not support web push." };
  }
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!key) {
    return {
      supported: false,
      reason:
        "Web push is not configured on this deployment. Reminders still arrive by e-mail and in this list.",
    };
  }
  return { supported: true, reason: "" };
}

/** The VAPID key is base64url; the Push API wants raw bytes. */
function decodeKey(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export default function NotificationsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pushBusy, setPushBusy] = useState(false);

  const { filters, setFilter, page, pageSize, setPage, setPageSize } = useUrlFilters({
    tab: "all",
    page: 1,
    page_size: 50,
  });

  const tab = filters.tab === "unread" ? "unread" : "all";
  const queryParams = { unread_only: tab === "unread", limit: pageSize, page };

  const query = useQuery({
    queryKey: qk.notifications.list(queryParams),
    queryFn: () => api<NotificationFeed>("/notifications", { query: queryParams }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const markOne = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast.error(
        "Could not mark it as read",
        error instanceof ApiError ? error.detail : "Please try again.",
      ),
  });

  const markAll = useMutation({
    mutationFn: () => api<{ marked: number }>("/notifications/read-all", { method: "POST" }),
    onSuccess: (result) => {
      toast.success(
        "All caught up",
        result?.marked ? `${result.marked} notifications marked as read.` : "Nothing was unread.",
      );
      void refresh();
    },
    onError: (error) =>
      toast.error(
        "Could not mark everything as read",
        error instanceof ApiError ? error.detail : "Please try again.",
      ),
  });

  const push = pushAvailability();

  const enablePush = async () => {
    if (!push.supported) return;
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.info("Push not enabled", "Your browser blocked the permission request.");
        return;
      }
      const registration =
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register("/sw.js"));
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(import.meta.env.VITE_VAPID_PUBLIC_KEY as string),
        }));
      const json = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> };
      await api("/notifications/push/subscribe", {
        method: "POST",
        json: {
          endpoint: json.endpoint,
          keys: json.keys ?? {},
          user_agent: navigator.userAgent,
        },
      });
      toast.success("Push notifications are on", "This device will now receive renewal alerts.");
    } catch (error) {
      // A missing service worker or a refused permission is not a fault; say
      // what happened rather than leaving the button spinning.
      toast.error(
        "Could not enable push notifications",
        error instanceof ApiError
          ? error.detail
          : "This device could not register for push. E-mail reminders are unaffected.",
      );
    } finally {
      setPushBusy(false);
    }
  };

  const total = query.data?.total ?? 0;
  const unread = query.data?.unread ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const tabItems: TabItem[] = [
    { id: "all", label: "All", count: total },
    { id: "unread", label: "Unread", count: unread, tone: unread ? "danger" : "neutral" },
  ];

  const rows = query.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Reminders, escalations and system messages, newest first."
        actions={
          <Button
            icon="check"
            variant="secondary"
            onClick={() => markAll.mutate()}
            loading={markAll.isPending}
            disabled={unread === 0}
          >
            Mark all as read
          </Button>
        }
      />

      <div className="bg-surface px-4 sm:px-5">
        <Tabs items={tabItems} value={tab} onChange={(id) => setFilter("tab", id)} />
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        {query.isPending ? (
          <SkeletonRows rows={6} />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} className="py-16" />
        ) : !rows.length ? (
          <Card>
            <EmptyState
              icon={tab === "unread" ? "check-circle" : "bell"}
              title={tab === "unread" ? "Nothing unread" : "No notifications yet"}
              description={
                tab === "unread"
                  ? "You have read everything in your notification centre."
                  : "Reminders for the obligations you own will appear here as their renewal dates approach."
              }
              action={
                tab === "unread" ? (
                  <Button variant="secondary" onClick={() => setFilter("tab", "all")}>
                    Show all notifications
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {rows.map((item) => {
                const isUnread = !item.read_at;
                const icon = SEVERITY_ICON[item.severity] ?? "info";
                const severityClass = SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE.info;
                const content = (
                  <>
                    <span
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border",
                        severityClass,
                      )}
                    >
                      <Icon name={icon} size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "text-sm text-ink",
                            isUnread ? "font-semibold" : "font-medium",
                          )}
                        >
                          {item.title}
                        </span>
                        {isUnread && <Badge />}
                      </span>
                      {item.body && (
                        <span className="mt-0.5 block text-xs text-ink-muted">{item.body}</span>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-ink-subtle">
                        <span title={formatDateTime(item.created_at)}>
                          {formatRelative(item.created_at)}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="capitalize">{item.category.replace(/_/g, " ")}</span>
                        {item.link && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="inline-flex items-center gap-0.5 font-medium text-brand-700">
                              Open obligation
                              <Icon name="arrow-up-right" size={11} />
                            </span>
                          </>
                        )}
                      </span>
                    </span>
                  </>
                );

                return (
                  <li key={item.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                    {item.link ? (
                      <Link
                        to={item.link}
                        className="flex min-w-0 flex-1 items-start gap-3 rounded-[var(--radius-control)] focus-visible:outline-2"
                        onClick={() => {
                          if (isUnread) markOne.mutate(item.id);
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-start gap-3">{content}</div>
                    )}

                    {isUnread && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="check"
                        className="shrink-0"
                        loading={markOne.isPending && markOne.variables === item.id}
                        onClick={() => markOne.mutate(item.id)}
                      >
                        Mark read
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={setPageSize}
            />
          </Card>
        )}

        {/* -------------------------- Push notifications -------------------------- */}
        <Card>
          <CardHeader
            title="Push notifications"
            description="Get renewal alerts on this device, even when ComplyTrack is closed."
          />
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <p className="text-sm text-ink-muted">
              {push.supported
                ? "Turning this on asks your browser for permission and registers this device with the compliance service."
                : push.reason}
            </p>
            <Button
              icon="bell"
              variant={push.supported ? "primary" : "secondary"}
              disabled={!push.supported}
              loading={pushBusy}
              onClick={() => void enablePush()}
              className="sm:shrink-0"
            >
              {push.supported ? "Enable push notifications" : "Push unavailable"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** The unread marker — a shape as well as a colour. */
function Badge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-2xs font-semibold text-brand-700">
      <span aria-hidden className="size-1.5 rounded-full bg-brand-600" />
      Unread
    </span>
  );
}
