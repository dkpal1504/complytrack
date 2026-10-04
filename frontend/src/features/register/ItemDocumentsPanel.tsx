/**
 * The documents filed against one obligation (DS-01 / DS-07).
 *
 * A thin reader over `GET /documents?item_id=…` plus the shared uploader and
 * the shared row actions, so nothing about uploads, downloads, verification or
 * versioning is reimplemented for this tab.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/Feedback";
import { DataTable, type Column } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";
import { formatBytes, formatDate, formatDateTime, truncate } from "@/lib/format";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { DocumentActionButtons } from "@/features/documents/DocumentActionButtons";
import { DocumentUploader } from "@/features/documents/DocumentUploader";
import type { CycleSummary, ItemDetail } from "@/features/register/api-types";
import type { DocumentRow } from "@/features/documents/api-types";

export interface ItemDocumentsPanelProps {
  item: ItemDetail;
  instance: CycleSummary | null;
  onChanged?: () => void;
}

export function ItemDocumentsPanel({ item, instance, onChanged }: ItemDocumentsPanelProps) {
  const { can } = useAuth();
  const [uploadOpen, setUploadOpen] = useState(false);

  const documents = useQuery({
    queryKey: qk.documents.list({ item_id: item.id }),
    queryFn: () => api<DocumentRow[]>("/documents", { query: { item_id: item.id } }),
  });

  const canUpload = can(PERM.UPDATE_ASSIGNED);
  const rows = documents.data ?? [];

  const columns: Column<DocumentRow>[] = [
    {
      key: "title",
      header: "Document",
      isTitle: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{truncate(row.title, 60)}</p>
          <p className="text-2xs text-ink-subtle">{truncate(row.file_name, 48)}</p>
        </div>
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
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="tabular text-xs">v{row.version_no}</span>
          {row.is_current && (
            <span className="text-2xs font-medium text-rag-green">current</span>
          )}
        </span>
      ),
    },
    {
      key: "size_bytes",
      header: "Size",
      hideBelow: "md",
      mobileHidden: true,
      align: "right",
      cell: (row) => <span className="tabular text-xs">{formatBytes(row.size_bytes)}</span>,
    },
    {
      key: "created_at",
      header: "Uploaded",
      mobileLabel: "Uploaded",
      cell: (row) => <span className="text-xs">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: "expiry_date",
      header: "Expires",
      hideBelow: "lg",
      mobileHidden: true,
      cell: (row) => <span className="tabular text-xs">{formatDate(row.expiry_date)}</span>,
    },
    {
      key: "sha256",
      header: "SHA-256",
      hideBelow: "xl",
      mobileHidden: true,
      cell: (row) => (
        <code className="font-mono text-2xs text-ink-subtle" title={row.sha256}>
          {row.sha256.slice(0, 12)}…
        </code>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Document actions</span>,
      align: "right",
      mobileHidden: true,
      cell: (row) => (
        <DocumentActionButtons document={row} compact onChanged={onChanged} />
      ),
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h3 className="text-sm font-semibold text-ink">Documents on file</h3>
          <p className="text-2xs text-ink-subtle">
            Certificates, acknowledgements, challans and reports for this obligation
            {instance ? ` — uploading now files them against ${instance.cycle_label}` : ""}.
          </p>
        </div>
        {canUpload ? (
          <Button icon="upload" variant="primary" onClick={() => setUploadOpen(true)}>
            Upload document
          </Button>
        ) : (
          <Chip icon="lock">Read-only — uploading needs update rights</Chip>
        )}
      </div>

      {documents.isPending ? (
        <div className="p-4 sm:p-5">
          <SkeletonRows rows={4} />
        </div>
      ) : documents.isError ? (
        <div className="p-4 sm:p-5">
          <ErrorState error={documents.error} onRetry={() => void documents.refetch()} />
        </div>
      ) : (
        <DataTable<DocumentRow>
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          caption={`Documents filed against ${item.item_code}: title, type, version, upload date, expiry and integrity hash.`}
          empty={
            <EmptyState
              icon="document"
              title="No documents yet"
              description="Upload the licence, its acknowledgements and the fee challans so an inspector can find them here."
              action={
                canUpload ? (
                  <Button variant="primary" icon="upload" onClick={() => setUploadOpen(true)}>
                    Upload document
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <DocumentUploader
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        itemId={item.id}
        instanceId={instance?.id ?? null}
        itemLabel={`${item.item_code} · ${item.name}`}
        lockItem
        onUploaded={() => onChanged?.()}
      />
    </Card>
  );
}
