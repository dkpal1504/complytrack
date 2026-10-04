/**
 * Auditor share links (PRD DS-09 / AC-07).
 *
 * One thing the API makes plain and the UI must not hide: a link is scoped to
 * an obligation or a whole unit — never to a single document — and whoever
 * holds the URL can open what it covers until it expires. The dialog says so
 * in words, shows the expiry, and offers revoke.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, SkeletonRows, useToast } from "@/components/ui/Feedback";
import { Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { Icon } from "@/components/ui/Icon";
import { api, ApiError } from "@/lib/api";
import { copyToClipboard } from "@/lib/hooks";
import { qk, queryClient } from "@/lib/query";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useLookups, toOptions } from "@/features/org/useReference";
import type { ShareLinkRow } from "@/features/documents/api-types";
import type { ComplianceItemSummary, Paginated } from "@/types/api";

const EXPIRY_OPTIONS = [
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
  { value: "336", label: "14 days" },
  { value: "720", label: "30 days (maximum)" },
];

export interface ShareLinkDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selects the obligation this link should cover. */
  itemId?: string | null;
  itemLabel?: string | null;
}

function absolute(url: string) {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

export function ShareLinkDialog({ open, onClose, itemId = null, itemLabel = null }: ShareLinkDialogProps) {
  const toast = useToast();
  const lookups = useLookups(open);

  const [scopeItem, setScopeItem] = useState(itemId ?? "");
  const [scopeUnit, setScopeUnit] = useState("");
  const [createdFor, setCreatedFor] = useState("");
  const [hours, setHours] = useState("72");
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const links = useQuery({
    // The `share-links` factory takes a document id in the shared key model;
    // the live endpoint lists every active link at once, so "vault" is used as
    // the scope marker rather than inventing an inline key.
    queryKey: qk.documents.shareLinks("vault"),
    queryFn: () => api<ShareLinkRow[]>("/documents/share-links"),
    enabled: open,
  });

  const items = useQuery({
    queryKey: qk.items.list({ scope: "share-picker", page_size: 200 }),
    queryFn: () =>
      api<Paginated<ComplianceItemSummary>>("/items", {
        query: { page_size: 200, sort: "name", direction: "asc" },
      }),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const itemOptions = (items.data?.items ?? []).map((row) => ({
    value: row.id,
    label: `${row.item_code} · ${row.name}`,
  }));

  const create = useMutation({
    mutationFn: () =>
      api<ShareLinkRow>("/documents/share-links", {
        method: "POST",
        json: {
          scope_item_id: scopeItem || null,
          scope_unit_id: scopeUnit || null,
          created_for: createdFor.trim() || null,
          expires_in_hours: Number(hours) || 72,
        },
      }),
    onSuccess: async (link) => {
      setFormError(null);
      toast.success("Share link created", `Valid until ${formatDateTime(link.expires_at)}.`);
      await queryClient.invalidateQueries({ queryKey: qk.documents.shareLinks("vault") });
      const ok = await copyToClipboard(absolute(link.url));
      if (ok) {
        setCopiedId(link.id);
        toast.info("Link copied", "Send it to the auditor — it expires automatically.");
      }
    },
    onError: (error) =>
      setFormError(error instanceof ApiError ? error.detail : "Could not create the link."),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api<{ detail: string }>(`/documents/share-links/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Share link revoked", "The URL stops working immediately.");
      await queryClient.invalidateQueries({ queryKey: qk.documents.shareLinks("vault") });
    },
    onError: (error) =>
      toast.error("Could not revoke the link", error instanceof ApiError ? error.detail : undefined),
  });

  const copy = async (row: ShareLinkRow) => {
    const ok = await copyToClipboard(absolute(row.url));
    if (ok) {
      setCopiedId(row.id);
      toast.success("Link copied");
    } else {
      toast.error("Could not copy", "Select the URL and copy it manually.");
    }
  };

  const scopeMissing = !scopeItem && !scopeUnit;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share with an auditor"
      description="A time-limited, view-only link. Anyone holding the URL can open what it covers until it expires."
      size="lg"
      footer={
        <Button onClick={onClose} block className="sm:w-auto">
          Done
        </Button>
      }
    >
      <div className="space-y-5">
        <p
          role="note"
          className="flex items-start gap-2 rounded-[var(--radius-control)] border border-rag-amber-border bg-rag-amber-bg px-3 py-2 text-xs text-rag-amber"
        >
          <Icon name="shield-alert" size={15} className="mt-0.5 shrink-0" />
          <span>
            The link exposes every document under the scope you choose. It is watermarked and its
            downloads are logged. Revoke it as soon as the inspection is over.
          </span>
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Obligation" hint={itemLabel ? "Pre-selected from the row" : "Optional"}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={scopeItem}
                onChange={(event) => setScopeItem(event.target.value)}
                placeholder="No specific obligation"
                options={itemOptions}
              />
            )}
          </Field>
          <Field label="Unit / location" hint="Optional">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={scopeUnit}
                onChange={(event) => setScopeUnit(event.target.value)}
                placeholder="No specific unit"
                options={toOptions(lookups.data?.units, { withCode: true })}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Created for" hint="Recorded on the audit trail">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={createdFor}
                onChange={(event) => setCreatedFor(event.target.value)}
                placeholder="e.g. Mr. Iyer, Factory Inspector"
              />
            )}
          </Field>
          <Field label="Expires in">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                options={EXPIRY_OPTIONS}
              />
            )}
          </Field>
        </div>

        {scopeMissing && (
          <p className="text-xs text-ink-muted">
            Choose an obligation or a unit so the link covers something specific.
          </p>
        )}

        {formError && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-rag-red-border bg-rag-red-bg px-3 py-2 text-sm text-rag-red">
            {formError}
          </p>
        )}

        <Button
          variant="primary"
          icon="link"
          onClick={() => create.mutate()}
          loading={create.isPending}
          disabled={scopeMissing}
          block
        >
          Create share link
        </Button>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Active links</h3>
          {links.isPending ? (
            <SkeletonRows rows={2} />
          ) : links.error ? (
            <ErrorState error={links.error} onRetry={() => void links.refetch()} />
          ) : (links.data ?? []).length === 0 ? (
            <EmptyState
              icon="link"
              title="No active share links"
              description="Create one above when an inspector needs read-only access."
            />
          ) : (
            <ul className="space-y-2">
              {(links.data ?? []).map((row) => (
                <li
                  key={row.id}
                  className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs text-ink">{absolute(row.url)}</code>
                    <Button size="sm" icon="copy" onClick={() => void copy(row)} aria-label="Copy link">
                      {copiedId === row.id ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon="trash"
                      onClick={() => revoke.mutate(row.id)}
                      loading={revoke.isPending && revoke.variables === row.id}
                      aria-label="Revoke link"
                    >
                      Revoke
                    </Button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-ink-muted">
                    <Chip icon="clock">Expires {formatRelative(row.expires_at)}</Chip>
                    <span>{formatDateTime(row.expires_at)}</span>
                    <span>· {row.access_count} visit{row.access_count === 1 ? "" : "s"}</span>
                    {row.created_for && <span>· for {row.created_for}</span>}
                    {row.watermark && <span>· watermarked</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
