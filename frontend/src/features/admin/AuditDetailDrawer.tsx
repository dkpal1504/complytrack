/**
 * The full before/after view of one audit entry (AT-01, AT-02).
 */

import { ButtonLink } from "@/components/ui/Button";
import { DescriptionItem } from "@/components/ui/Form";
import { Drawer } from "@/components/ui/Overlay";
import { DetailGrid, Panel } from "@/components/ui/Page";
import { formatDateTime, titleCase } from "@/lib/format";
import type { AuditRowLive } from "@/features/admin/audit-types";
import { prettyJson, recordHref, recordLabel } from "@/features/admin/audit-utils";

function CodeBlock({ value }: { value: string }) {
  return (
    <pre className="scroll-thin max-h-72 overflow-auto rounded-[var(--radius-control)] border border-line bg-surface-muted p-3 text-2xs leading-relaxed whitespace-pre-wrap text-ink">
      {value}
    </pre>
  );
}

export function AuditDetailDrawer({
  row,
  open,
  onClose,
}: {
  row: AuditRowLive | null;
  open: boolean;
  onClose: () => void;
}) {
  const href = row ? recordHref(row.entity_type, row.entity_id) : "";

  return (
    <Drawer
      open={open && row !== null}
      onClose={onClose}
      title={row ? `${titleCase(row.action)} · ${recordLabel(row.entity_type)}` : "Audit entry"}
      description={row ? formatDateTime(row.ts_utc) : undefined}
      size="xl"
      footer={
        href ? (
          <ButtonLink to={href} variant="primary" icon="arrow-up-right" onClick={onClose}>
            Open affected record
          </ButtonLink>
        ) : undefined
      }
    >
      {row && (
        <div className="space-y-5">
          <DetailGrid columns={2}>
            <DescriptionItem label="When">{formatDateTime(row.ts_utc)}</DescriptionItem>
            <DescriptionItem label="User">{row.user_email ?? "—"}</DescriptionItem>
            <DescriptionItem label="Action">{titleCase(row.action)}</DescriptionItem>
            <DescriptionItem label="Entity">
              {recordLabel(row.entity_type)}
            </DescriptionItem>
            <DescriptionItem label="Entity ID">
              <span className="text-2xs break-all">{row.entity_id ?? "—"}</span>
            </DescriptionItem>
            <DescriptionItem label="Field">{row.field ?? "—"}</DescriptionItem>
            <DescriptionItem label="IP address">{row.ip ?? "—"}</DescriptionItem>
            <DescriptionItem label="Client">
              <span className="text-2xs break-all">{row.user_agent ?? "—"}</span>
            </DescriptionItem>
            <DescriptionItem label="Entry hash">
              <span className="text-2xs break-all" title={row.hash}>
                {row.hash}
              </span>
            </DescriptionItem>
            <DescriptionItem label="Previous hash">
              <span className="text-2xs break-all" title={row.prev_hash}>
                {row.prev_hash}
              </span>
            </DescriptionItem>
          </DetailGrid>

          <Panel title="Reason for the change" icon="info">
            <p className="text-sm text-ink">{row.reason ?? "No reason was recorded."}</p>
          </Panel>

          {row.changes && Object.keys(row.changes).length > 0 ? (
            <Panel title="Fields changed" icon="history">
              <CodeBlock value={prettyJson(row.changes)} />
            </Panel>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Panel title="Before" icon="arrow-left">
                <CodeBlock value={prettyJson(row.old_value)} />
              </Panel>
              <Panel title="After" icon="arrow-right">
                <CodeBlock value={prettyJson(row.new_value)} />
              </Panel>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
