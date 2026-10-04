/**
 * The escalation ladder (EX-01, OW-04).
 *
 * Two things are shown side by side: the default ladder the engine applies, and
 * the live rule set stored against each escalation profile. The rules are read
 * from the API and there is no endpoint that changes them, so this tab is
 * deliberately read-only — it is the reference an administrator checks when an
 * escalation reaches the wrong desk.
 */

import { useQuery } from "@tanstack/react-query";

import { Chip } from "@/components/ui/Chip";
import { ErrorState } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";
import { CHANNELS, roleLabel, triggerLabel } from "@/features/admin/admin-utils";
import type {
  EscalationLevelRow,
  EscalationMatrixResponse,
  EscalationRuleRow,
} from "@/features/admin/admin-types";

export function EscalationLadderTab() {
  const query = useQuery({
    queryKey: qk.reminders.matrix,
    queryFn: () => api<EscalationMatrixResponse>("/reminders/escalation-matrix"),
  });

  const levels = query.data?.levels ?? [];
  const profiles = query.data?.profiles ?? [];

  const columns: Column<EscalationLevelRow>[] = [
    {
      key: "level",
      header: "Level",
      isTitle: true,
      sortValue: (row) => row.level,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="tabular inline-flex size-6 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-ink">
            {row.level}
          </span>
          <span className="font-medium text-ink">{row.label}</span>
        </div>
      ),
    },
    {
      key: "trigger",
      header: "Fires",
      sortValue: (row) => row.trigger_days,
      cell: (row) => triggerLabel(row.trigger_days, row.trigger_direction),
    },
    {
      key: "condition",
      header: "Only while status is",
      hideBelow: "md",
      cell: (row) =>
        row.status_condition.length === 0 ? (
          <span className="text-ink-subtle">Any open status</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.status_condition.map((status) => (
              <Chip key={status}>{status}</Chip>
            ))}
          </div>
        ),
    },
    {
      key: "notifies",
      header: "Notifies",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.notify_roles.map((role) => (
            <Chip key={role} icon="bell">
              {roleLabel(role)}
            </Chip>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Panel title="The escalation ladder" icon="bell-ring">
        <p className="mb-3 text-xs text-ink-muted">
          The ladder widens as a deadline approaches and has passed: the owner is told first, then
          the department head, then the unit head and the Compliance Team, and finally management
          and the director. A Critical obligation escalates one level sooner.
        </p>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption="Default escalation levels"
            columns={columns}
            rows={levels}
            getRowId={(row) => String(row.level)}
            loading={query.isPending}
            empty={<p className="py-6 text-center text-sm text-ink-muted">No ladder defined.</p>}
          />
        )}
      </Panel>

      <Panel title="Live rule set" icon="sliders">
        <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2 text-2xs text-ink-muted">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          These are the rules the engine actually reads. This build exposes no route that edits
          them, so changes are made in configuration and applied by a deployment.
        </div>

        {query.isPending ? (
          <p className="text-sm text-ink-muted">Loading the rule set…</p>
        ) : profiles.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No escalation profile is configured, so the default ladder above is used unchanged.
          </p>
        ) : (
          <div className="space-y-4">
            {profiles.map((profile) => (
              <section key={profile.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-ink">{profile.name}</h3>
                  {profile.criticality && <Chip icon="gauge">{profile.criticality}</Chip>}
                  {profile.is_default && <Chip icon="check">Default</Chip>}
                </div>
                {profile.rules.length === 0 ? (
                  <p className="text-xs text-ink-muted">
                    No explicit rules — the default ladder applies.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {profile.rules.map((rule) => (
                      <RuleRow key={rule.id} rule={rule} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RuleRow({ rule }: { rule: EscalationRuleRow }) {
  return (
    <li className="rounded-[var(--radius-control)] border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular inline-flex size-6 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-ink">
          {rule.level}
        </span>
        <p className="text-sm font-medium text-ink">{rule.label}</p>
        <Chip icon="clock">{triggerLabel(rule.trigger_days, rule.trigger_direction)}</Chip>
      </div>
      <div className="mt-2 grid gap-2 text-2xs text-ink-muted sm:grid-cols-2">
        <p>
          <span className="font-semibold text-ink">Notifies:</span>{" "}
          {rule.notify_roles.length ? rule.notify_roles.map(roleLabel).join(", ") : "nobody"}
          {rule.notify_extra.length > 0 && ` (plus ${rule.notify_extra.join(", ")})`}
        </p>
        <p>
          <span className="font-semibold text-ink">Channels:</span>{" "}
          {rule.channels.length
            ? rule.channels
                .map((channel) => CHANNELS.find((entry) => entry.key === channel)?.label ?? channel)
                .join(", ")
            : "profile default"}
        </p>
        <p>
          <span className="font-semibold text-ink">Only while status is:</span>{" "}
          {rule.status_condition.length ? rule.status_condition.join(", ") : "any open status"}
        </p>
        {rule.message && (
          <p>
            <span className="font-semibold text-ink">Message:</span> {rule.message}
          </p>
        )}
      </div>
    </li>
  );
}
