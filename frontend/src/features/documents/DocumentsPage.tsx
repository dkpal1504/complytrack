/**
 * The document vault (DS-01..DS-09).
 *
 * One screen for every file in scope: search it, filter it, download it, check
 * its integrity, read its version history, remove it, and — when an inspector
 * visits — issue a time-limited share link instead of handing over a copy.
 *
 * The API's list route only scopes by obligation or cycle (`GET /documents`
 * takes `item_id`, `instance_id`, `current_only`), so the obligation and
 * current-version filters go to the server and the rest — type, uploader, date
 * range, free text — run here, with a note on screen saying so.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/Feedback";
import { Checkbox, Field, Input, SearchInput, Select } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { DataTable, type Column } from "@/components/ui/Table";
import { PageHeader, ResultCount, Toolbar } from "@/components/ui/Page";
import { api } from "@/lib/api";
import { useDebouncedValue, useUrlFilters } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { formatBytes, formatDate, formatDateTime, formatRelative, truncate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { stringsToOptions, toOptions, useLookups, useMeta } from "@/features/org/useReference";
import { DocumentActionButtons } from "@/features/documents/DocumentActionButtons";
import { DocumentUploader } from "@/features/documents/DocumentUploader";
import { ShareLinkDialog } from "@/features/documents/ShareLinkDialog";
import type { DocumentRow } from "@/features/documents/api-types";
import type { ComplianceItemSummary, Paginated } from "@/types/api";

interface VaultFilters extends Record<string, unknown> {
  search: string;
  item_id: string;
  doc_type: string;
  uploaded_by: string;
  from: string;
  to: string;
  current_only: boolean;
}

const DEFAULTS: VaultFilters = {
  search: "",
  item_id: "",
  doc_type: "",
  uploaded_by: "",
  from: "",
  to: "",
  current_only: false,
};

export default function DocumentsPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const lookups = useLookups();

  const { filters, setFilter, reset, activeCount } = useUrlFilters<VaultFilters>(DEFAULTS);
  const search = useDebouncedValue(filters.search, 300);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Only these two are real query parameters on the API.
  const serverQuery = useMemo(
    () => ({
      item_id: filters.item_id || undefined,
      current_only: filters.current_only || undefined,
    }),
    [filters.item_id, filters.current_only],
  );

  const documents = useQuery({
    queryKey: qk.documents.list(serverQuery),
    queryFn: () => api<DocumentRow[]>("/documents", { query: serverQuery }),
  });

  // The obligation picker. Sharing the uploader's cache key means one fetch
  // serves both the filter bar and the upload dialog.
  const items = useQuery({
    queryKey: qk.items.list({ scope: "upload-picker", page_size: 200 }),
    queryFn: () =>
      api<Paginated<ComplianceItemSummary>>("/items", {
        query: { page_size: 200, sort: "name", direction: "asc" },
      }),
    staleTime: 5 * 60_000,
  });

  const uploaderName = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of lookups.data?.users ?? []) map.set(person.id, person.name);
    return map;
  }, [lookups.data]);

  const rows = useMemo(() => {
    const all = documents.data ?? [];
    const needle = search.trim().toLowerCase();
    const from = filters.from ? new Date(filters.from).getTime() : null;
    const to = filters.to ? new Date(filters.to).getTime() + 86_399_000 : null;

    return all
      .filter((row) => {
        if (filters.doc_type && row.doc_type !== filters.doc_type) return false;
        if (filters.uploaded_by && row.uploaded_by !== filters.uploaded_by) return false;
        if (from !== null && new Date(row.created_at).getTime() < from) return false;
        if (to !== null && new Date(row.created_at).getTime() > to) return false;
        if (needle) {
          const haystack = [row.title, row.file_name, row.item_code, row.reference_number]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [documents.data, search, filters.doc_type, filters.uploaded_by, filters.from, filters.to]);

  const canUpload = can(PERM.UPDATE_ASSIGNED);
  const canShare = can(PERM.CREATE_SHARE_LINK);

  const columns: Column<DocumentRow>[] = [
    {
      key: "title",
      header: "Document",
      isTitle: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{truncate(row.title, 64)}</p>
          <p className="text-2xs text-ink-subtle">{truncate(row.file_name, 52)}</p>
        </div>
      ),
    },
    {
      key: "item_code",
      header: "Obligation",
      mobileLabel: "Obligation",
      cell: (row) =>
        row.item_id ? (
          <Link
            to={`/items/${row.item_id}`}
            className="font-mono text-xs text-brand-700 hover:underline"
          >
            {row.item_code ?? "Open"}
          </Link>
        ) : (
          <span className="text-xs text-ink-subtle">General</span>
        ),
    },
    {
      key: "doc_type",
      header: "Type",
      mobileLabel: "Type",
      cell: (row) => <Chip>{row.doc_type}</Chip>,
    },
    {
      key: "version_no",
      header: "Version",
      mobileLabel: "Version",
      align: "center",
      hideBelow: "lg",
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="tabular text-xs">v{row.version_no}</span>
          {!row.is_current && <span className="text-2xs text-ink-subtle">superseded</span>}
        </span>
      ),
    },
    {
      key: "size_bytes",
      header: "Size",
      align: "right",
      hideBelow: "xl",
      mobileHidden: true,
      cell: (row) => <span className="tabular text-xs">{formatBytes(row.size_bytes)}</span>,
    },
    {
      key: "uploaded_by",
      header: "Uploaded by",
      mobileLabel: "By",
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-xs">
          {row.uploaded_by ? (uploaderName.get(row.uploaded_by) ?? "Another user") : "—"}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Uploaded",
      mobileLabel: "Uploaded",
      hideBelow: "md",
      cell: (row) => (
        <span className="text-xs" title={formatDateTime(row.created_at)}>
          {formatRelative(row.created_at)}
        </span>
      ),
    },
    {
      key: "expiry_date",
      header: "Expires",
      mobileLabel: "Expires",
      hideBelow: "lg",
      cell: (row) =>
        row.expiry_date ? (
          <span
            className={cn(
              "text-xs",
              row.expires_in_days !== null && row.expires_in_days <= 30 && "text-rag-amber",
              row.expires_in_days !== null && row.expires_in_days < 0 && "text-rag-red",
            )}
          >
            {formatDate(row.expiry_date)}
          </span>
        ) : (
          <span className="text-xs text-ink-subtle">—</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Document actions</span>,
      align: "right",
      mobileHidden: true,
      cell: (row) => (
        <DocumentActionButtons
          document={row}
          compact
          onChanged={() => void documents.refetch()}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Document vault"
        description="Every certificate, acknowledgement, challan and report ComplyTrack holds — with its integrity hash, its versions and its audit trail."
        actions={
          <>
            {canUpload ? (
              <Button icon="upload" variant="primary" onClick={() => setUploadOpen(true)}>
                Upload
              </Button>
            ) : (
              <Chip icon="lock">Read-only — uploading needs update rights</Chip>
            )}
            {canShare && (
              <Button icon="link" onClick={() => setShareOpen(true)}>
                Share with an auditor
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4 p-4 sm:p-6">
        <Card className="overflow-hidden">
          <Toolbar label="Filter the document vault">
            <SearchInput
              value={filters.search}
              onChange={(next) => setFilter("search", next)}
              placeholder="Search title, file name, obligation or reference"
              className="sm:min-w-[18rem] sm:flex-1"
            />
            <Select
              aria-label="Obligation"
              value={filters.item_id}
              onChange={(event) => setFilter("item_id", event.target.value)}
              placeholder="Every obligation"
              className="sm:w-56"
              options={toOptions(
                (items.data?.items ?? []).map((row) => ({ id: row.id, name: `${row.item_code} · ${row.name}` })),
              )}
            />
            <Select
              aria-label="Document type"
              value={filters.doc_type}
              onChange={(event) => setFilter("doc_type", event.target.value)}
              placeholder="Every type"
              className="sm:w-44"
              options={stringsToOptions(meta.data?.document_type)}
            />
            <Select
              aria-label="Uploaded by"
              value={filters.uploaded_by}
              onChange={(event) => setFilter("uploaded_by", event.target.value)}
              placeholder="Anyone"
              className="sm:w-44"
              options={toOptions(lookups.data?.users)}
            />
          </Toolbar>

          <Toolbar label="More document filters" className="border-t-0 bg-surface-muted/40">
            <Field label="Uploaded from" className="sm:w-44">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={filters.from}
                  onChange={(event) => setFilter("from", event.target.value)}
                />
              )}
            </Field>
            <Field label="Uploaded to" className="sm:w-44">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={filters.to}
                  onChange={(event) => setFilter("to", event.target.value)}
                />
              )}
            </Field>
            <Checkbox
              className="sm:mt-6"
              label="Current versions only"
              checked={filters.current_only}
              onChange={(event) => setFilter("current_only", event.target.checked)}
            />
            <div className="flex flex-1 items-center justify-between gap-3 sm:mt-6">
              <p className="text-2xs text-ink-subtle">
                Type, uploader, dates and search are applied in this browser; the API scopes by
                obligation and cycle.
              </p>
              {activeCount > 0 && (
                <Button size="sm" variant="ghost" icon="x" onClick={reset}>
                  Clear all
                </Button>
              )}
            </div>
          </Toolbar>

          {documents.isPending ? (
            <div className="p-4 sm:p-5">
              <SkeletonRows rows={8} />
            </div>
          ) : documents.isError ? (
            <div className="p-4 sm:p-5">
              <ErrorState
                error={documents.error}
                title="The vault could not be loaded"
                onRetry={() => void documents.refetch()}
              />
            </div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-2 sm:px-5">
                <ResultCount shown={rows.length} total={documents.data?.length ?? 0} noun="document" />
              </div>
              <DataTable<DocumentRow>
                columns={columns}
                rows={rows}
                getRowId={(row) => row.id}
                caption="Document vault: title, obligation, type, version, size, uploader, upload date, expiry and actions."
                stickyHeader
                mobileBadges={(row) => (
                  <span className="flex flex-wrap items-center gap-1">
                    <Chip>{row.doc_type}</Chip>
                    {row.expires_in_days !== null && row.expires_in_days < 0 && (
                      <Chip className="border-rag-red-border bg-rag-red-bg text-rag-red">
                        Expired
                      </Chip>
                    )}
                  </span>
                )}
                empty={
                  activeCount > 0 || search ? (
                    <EmptyState
                      icon="search"
                      title="No document matches those filters"
                      description="Try a broader date range, or clear the filters to see the whole vault."
                      action={
                        <Button icon="x" onClick={reset}>
                          Clear all filters
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon="document"
                      title="The vault is empty"
                      description="Upload a certificate, an acknowledgement or a fee challan to start the record."
                      action={
                        canUpload ? (
                          <Button variant="primary" icon="upload" onClick={() => setUploadOpen(true)}>
                            Upload a document
                          </Button>
                        ) : undefined
                      }
                    />
                  )
                }
              />
            </>
          )}
        </Card>

        <p className="flex items-start gap-2 px-1 text-2xs text-ink-subtle">
          <Icon name="info" size={13} className="mt-0.5 shrink-0" />
          <span>
            Removing a document withdraws it from the vault but keeps it for audit. Documents are
            never overwritten: a re-upload with the same title and type becomes the next version.
          </span>
        </p>
      </div>

      <DocumentUploader
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => void documents.refetch()}
      />
      <ShareLinkDialog open={shareOpen} onClose={() => setShareOpen(false)} />
    </>
  );
}
