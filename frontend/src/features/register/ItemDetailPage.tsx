/**
 * One obligation, in full (CD-04..CD-10, EX-01..EX-10).
 *
 * The page is a reader first: the header and the summary panel answer "what is
 * this, when does it fall due, how exposed are we" without a click, and the
 * tabs hold the working parts — the renewal cycle, its checklist, the documents,
 * the conversation and the history.
 *
 * Everything that writes is gated on a permission, and a role that cannot write
 * is told so in words rather than shown an empty page.
 */

import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  Chip,
  CriticalityChip,
  DerivedStatusChip,
  RagDot,
  StatusChip,
} from "@/components/ui/Chip";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { DescriptionItem } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Breadcrumbs, Tabs, type TabItem } from "@/components/ui/Nav";
import { DetailGrid, PageHeader, Panel, StatTile } from "@/components/ui/Page";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import {
  formatCountdown,
  formatDate,
  formatMoney,
  formatNumber,
  titleCase,
  truncate,
} from "@/lib/format";
import { RAG_LABEL } from "@/lib/status";
import { cn } from "@/lib/cn";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { ArchiveItemDialog } from "@/features/register/ArchiveItemDialog";
import { ChecklistPanel } from "@/features/register/ChecklistPanel";
import { CommentsPanel } from "@/features/register/CommentsPanel";
import { EditItemDialog } from "@/features/register/EditItemDialog";
import { ItemDocumentsPanel } from "@/features/register/ItemDocumentsPanel";
import { TimelinePanel } from "@/features/register/TimelinePanel";
import { WorkflowPanel } from "@/features/register/WorkflowPanel";
import type { CycleSummary, ItemDetail } from "@/features/register/api-types";
import type { Rag } from "@/types/api";

const RAG_TONE: Record<Rag, string> = {
  red: "border-rag-red-border bg-rag-red-bg text-rag-red",
  amber: "border-rag-amber-border bg-rag-amber-bg text-rag-amber",
  green: "border-rag-green-border bg-rag-green-bg text-rag-green",
  grey: "border-rag-grey-border bg-rag-grey-bg text-rag-grey",
};

const TABS = [
  { id: "overview", label: "Overview", icon: "document" },
  { id: "cycle", label: "Renewal cycle", icon: "progress" },
  { id: "checklist", label: "Checklist", icon: "clipboard-check" },
  { id: "documents", label: "Documents", icon: "document" },
  { id: "comments", label: "Comments", icon: "send" },
  { id: "history", label: "History", icon: "history" },
] as const;

export default function ItemDetailPage() {
  const { itemId = "" } = useParams<{ itemId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();

  const tab = searchParams.get("tab") ?? "overview";
  const [editOpen, setEditOpen] = useState(false);
  const [archiveMode, setArchiveMode] = useState<"archive" | "restore" | null>(null);

  const detail = useQuery({
    queryKey: qk.items.detail(itemId),
    queryFn: () => api<ItemDetail>(`/items/${itemId}`),
  });

  const item = detail.data;

  // The register summary carries the current cycle as `current_instance`, but a
  // `CycleSummary` (with the checklist progress) only lives in `instances[]`.
  // Prefer the matching one, and fall back to the most recent cycle on record so
  // a closed-and-rolled-forward obligation still shows its working parts.
  const instance = useMemo<CycleSummary | null>(() => {
    const list = item?.instances ?? [];
    if (list.length === 0) return null;
    const currentId = item?.current_instance?.id;
    return list.find((row) => row.id === currentId) ?? list[0];
  }, [item]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.items.detail(itemId) });
  };

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  if (detail.isPending) return <PageSpinner label="Loading the obligation" />;

  if (detail.isError || !item) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          error={detail.error}
          title="This obligation could not be loaded"
          onRetry={() => void detail.refetch()}
        />
        <div className="mt-3">
          <Link to="/register" className="text-sm text-brand-700 hover:underline">
            Back to the register
          </Link>
        </div>
      </div>
    );
  }

  const canEdit = can(PERM.MANAGE_ITEMS);
  const canArchive = can(PERM.DELETE_ARCHIVE);
  const isArchived = Boolean(item.delete_reason);
  const readOnly = !canEdit && !can(PERM.UPDATE_ASSIGNED);

  const checklistProgress = instance?.progress;

  const tabs: TabItem[] = TABS.map((entry) => {
    if (entry.id === "checklist" && checklistProgress && checklistProgress.total > 0) {
      return {
        ...entry,
        count: checklistProgress.pending,
        tone: checklistProgress.pending > 0 ? "warning" : "neutral",
      };
    }
    return { ...entry };
  });

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Register", to: "/register" },
              { label: item.item_code },
            ]}
          />
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg text-ink-muted">{item.item_code}</span>
            <span>{item.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{item.type}</span>
            {item.category_name && <span>· {item.category_name}</span>}
            {item.authority_name && <span>· {item.authority_name}</span>}
            {item.unit_name && <span>· {item.unit_name}</span>}
            {isArchived && (
              <Chip icon="restore" className="border-rag-grey-border bg-rag-grey-bg text-rag-grey">
                Archived
              </Chip>
            )}
          </span>
        }
        actions={
          <>
            {canEdit && (
              <Button icon="edit" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            )}
            {canArchive && (
              <Button
                icon={isArchived ? "restore" : "trash"}
                variant={isArchived ? "secondary" : "danger"}
                onClick={() => setArchiveMode(isArchived ? "restore" : "archive")}
              >
                {isArchived ? "Restore" : "Archive"}
              </Button>
            )}
          </>
        }
        tabs={<Tabs items={tabs} value={tab} onChange={setTab} />}
      />

      <div className="space-y-4 p-4 sm:p-6">
        {readOnly && (
          <p className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-line bg-surface-muted px-4 py-3 text-sm text-ink-muted">
            <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
            <span>
              You can read this obligation and everything attached to it, but your role cannot
              change it. Editing needs manage rights; recording progress on the cycle needs update
              rights on the obligation.
            </span>
          </p>
        )}

        {isArchived && item.delete_reason && (
          <p className="rounded-[var(--radius-card)] border border-rag-grey-border bg-rag-grey-bg px-4 py-3 text-sm text-ink-muted">
            <span className="font-medium">Archived.</span> {item.delete_reason} — restore it to put
            it back in the live register.
          </p>
        )}

        <SummaryPanel item={item} />

        {tab === "overview" && <OverviewTab item={item} instance={instance} />}

        {tab === "cycle" &&
          (instance ? (
            <WorkflowPanel item={item} instance={instance} onChanged={refresh} />
          ) : (
            <CycleMissingNote item={item} what="renewal cycle" />
          ))}

        {tab === "checklist" &&
          (instance ? (
            <ChecklistPanel item={item} instance={instance} onChanged={refresh} />
          ) : (
            <CycleMissingNote item={item} what="checklist" />
          ))}

        {tab === "documents" && (
          <ItemDocumentsPanel item={item} instance={instance} onChanged={refresh} />
        )}

        {tab === "comments" &&
          (instance ? (
            <CommentsPanel instanceId={instance.id} itemLabel={item.item_code} />
          ) : (
            <CycleMissingNote item={item} what="conversation" />
          ))}

        {tab === "history" &&
          (instance ? (
            <TimelinePanel instanceId={instance.id} />
          ) : (
            <CycleMissingNote item={item} what="history" />
          ))}
      </div>

      {canEdit && (
        <EditItemDialog
          key={item.updated_at}
          open={editOpen}
          item={item}
          onClose={() => setEditOpen(false)}
          onSaved={refresh}
        />
      )}

      {archiveMode && (
        <ArchiveItemDialog
          open
          itemId={item.id}
          itemLabel={`${item.item_code} · ${item.name}`}
          mode={archiveMode}
          onClose={() => setArchiveMode(null)}
          onDone={() => {
            setArchiveMode(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------- summary -------------------------------- */

function SummaryPanel({ item }: { item: ItemDetail }) {
  const countdown = formatCountdown(item.days_left);
  const tone = RAG_TONE[item.rag];

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className={cn("border-b border-line px-4 py-4 sm:px-5 lg:border-r lg:border-b-0", tone)}>
          <div className="flex flex-wrap items-center gap-2">
            <RagDot rag={item.rag} />
            <span className="text-2xs font-semibold tracking-wide uppercase">
              {RAG_LABEL[item.rag]}
            </span>
          </div>
          <p className="mt-2 text-2xl leading-tight font-semibold">{countdown}</p>
          <p className="mt-0.5 text-sm opacity-90">
            {item.is_perpetual
              ? "Perpetual licence — no expiry to track."
              : `Expires ${formatDate(item.expiry_date)}`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <DerivedStatusChip status={item.current_status} className="bg-surface/70" />
            <CriticalityChip criticality={item.criticality} />
            {item.current_instance && <StatusChip status={item.current_instance.status} />}
          </div>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <DetailGrid columns={3}>
            <DescriptionItem label="Derived status">{titleCase(item.current_status)}</DescriptionItem>
            <DescriptionItem label="Renewal due">
              {formatDate(item.renewal_due_date)}
            </DescriptionItem>
            <DescriptionItem label="Internal target">
              {formatDate(item.internal_target_date)}
            </DescriptionItem>
            <DescriptionItem label="Validity">
              {item.validity_value !== null && item.validity_unit
                ? `${item.validity_value} ${item.validity_unit}`
                : "—"}
            </DescriptionItem>
            <DescriptionItem label="Recurrence">
              {item.recurrence_rule ? titleCase(item.recurrence_rule) : "—"}
            </DescriptionItem>
            <DescriptionItem label="Applicability">
              <span className="flex flex-wrap items-center gap-1.5">
                {item.applicability}
                {item.applicability_justification && (
                  <Chip title={item.applicability_justification}>justified</Chip>
                )}
              </span>
            </DescriptionItem>
          </DetailGrid>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------- overview ------------------------------- */

function OverviewTab({ item, instance }: { item: ItemDetail; instance: CycleSummary | null }) {
  return (
    <div className="space-y-4">
      {item.description && (
        <Card className="p-4 sm:p-5">
          <p className="text-sm whitespace-pre-line text-ink">{item.description}</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Days to expiry"
          value={item.days_left === null ? "—" : formatNumber(item.days_left)}
          icon="clock"
          tone={item.rag === "red" ? "critical" : item.rag === "amber" ? "warning" : "good"}
          hint={formatCountdown(item.days_left)}
        />
        <StatTile
          label="Cycles on record"
          value={formatNumber(item.instances.length)}
          icon="progress"
          hint={instance ? `Latest: ${instance.cycle_label}` : "No cycle raised yet"}
        />
        <StatTile
          label="Fee"
          value={formatMoney(item.fee_amount)}
          icon="report"
          hint={item.grace_period_days ? `${item.grace_period_days}-day grace period` : undefined}
        />
        <StatTile
          label="Penalty per day"
          value={item.penalty_per_day ? formatMoney(item.penalty_per_day) : "—"}
          icon="alert"
          tone={item.penalty_per_day ? "warning" : "neutral"}
          hint="If it lapses"
        />
      </div>

      <Panel title="Identification" icon="document">
        <DetailGrid columns={3}>
          <DescriptionItem label="Obligation code">
            <span className="font-mono">{item.item_code}</span>
          </DescriptionItem>
          <DescriptionItem label="Type">{item.type}</DescriptionItem>
          <DescriptionItem label="Category">{item.category_name ?? "Uncategorised"}</DescriptionItem>
          <DescriptionItem label="Authority">{item.authority_name ?? "Not recorded"}</DescriptionItem>
          <DescriptionItem label="Reference number">
            {item.reference_number ?? "—"}
          </DescriptionItem>
          <DescriptionItem label="Criticality">
            <CriticalityChip criticality={item.criticality} />
          </DescriptionItem>
          <DescriptionItem label="Legal reference">
            {item.legal_reference_text ?? "—"}
          </DescriptionItem>
        </DetailGrid>
      </Panel>

      <Panel title="Dates and validity" icon="calendar">
        <DetailGrid columns={3}>
          <DescriptionItem label="Issue date">{formatDate(item.issue_date)}</DescriptionItem>
          <DescriptionItem label="Expiry date">
            {item.is_perpetual ? "Perpetual" : formatDate(item.expiry_date)}
          </DescriptionItem>
          <DescriptionItem label="Renewal due">{formatDate(item.renewal_due_date)}</DescriptionItem>
          <DescriptionItem label="Internal target">
            {formatDate(item.internal_target_date)}
          </DescriptionItem>
          <DescriptionItem label="Validity">
            {item.validity_value !== null && item.validity_unit
              ? `${item.validity_value} ${item.validity_unit}`
              : "—"}
          </DescriptionItem>
          <DescriptionItem label="Grace period">
            {item.grace_period_days ? `${item.grace_period_days} days` : "—"}
          </DescriptionItem>
        </DetailGrid>
      </Panel>

      <Panel title="Ownership" icon="users">
        <DetailGrid columns={3}>
          <DescriptionItem label="Unit">{item.unit_name ?? "Not unit-specific"}</DescriptionItem>
          <DescriptionItem label="Department">
            {item.department_name ?? "Unassigned"}
          </DescriptionItem>
          <DescriptionItem label="Owner">{item.owner_name ?? "Unassigned"}</DescriptionItem>
          <DescriptionItem label="Delegate">
            {item.delegate_id ? "Delegated — see the owner's delegate" : "None"}
          </DescriptionItem>
          <DescriptionItem label="Direct close">
            {item.allow_direct_close ? "Allowed" : "Not allowed"}
          </DescriptionItem>
        </DetailGrid>
      </Panel>

      <Panel title="Risk and notes" icon="shield-alert">
        <DetailGrid columns={2}>
          <DescriptionItem label="Applicability">
            {item.applicability}
            {item.applicability_justification ? (
              <span className="mt-0.5 block text-xs text-ink-muted">
                {item.applicability_justification}
              </span>
            ) : null}
          </DescriptionItem>
          <DescriptionItem label="Exposure if it lapses">
            {item.exposure_note ?? "No exposure note recorded."}
          </DescriptionItem>
          <DescriptionItem label="Documents the authority expects">
            {item.required_documents.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {item.required_documents.map((name) => (
                  <Chip key={name}>{truncate(name, 40)}</Chip>
                ))}
              </span>
            ) : (
              "None listed"
            )}
          </DescriptionItem>
          <DescriptionItem label="Tags">
            {item.tags.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <Chip key={tag}>{tag}</Chip>
                ))}
              </span>
            ) : (
              "None"
            )}
          </DescriptionItem>
        </DetailGrid>
        {item.remarks && (
          <p className="mt-4 border-t border-line pt-3 text-sm whitespace-pre-line text-ink-muted">
            {item.remarks}
          </p>
        )}
      </Panel>

      <Panel title="Cycles on record" icon="history">
        {item.instances.length === 0 ? (
          <EmptyState
            icon="progress"
            title="No cycle has been raised"
            description="Cycles appear here once the scheduler or an officer opens one for this obligation."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {item.instances.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">
                  {row.cycle_label}
                </span>
                <StatusChip status={row.status} />
                <span className="text-xs text-ink-muted">due {formatDate(row.due_date)}</span>
                {row.closed_at && (
                  <span className="text-2xs text-ink-subtle">
                    closed {formatDate(row.closed_at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------- shared -------------------------------- */

function CycleMissingNote({ item, what }: { item: ItemDetail; what: string }) {
  return (
    <EmptyState
      icon="progress"
      title={`No ${what} to show`}
      description={
        item.is_perpetual
          ? "This is a perpetual licence, so ComplyTrack does not raise renewal cycles for it."
          : `A ${what} exists once a compliance cycle has been opened for this obligation. Open one from the renewal cycle tab of a cycle-bearing obligation, or wait for the scheduler.`
      }
    />
  );
}
