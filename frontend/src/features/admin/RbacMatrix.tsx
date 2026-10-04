/**
 * The role / permission matrix (PRD Section 9).
 *
 * The server owns authorisation — it re-checks every request — so this is a
 * reference, not a control. The values are a faithful transcription of the
 * matrix in `backend/app/core/rbac.py`, which is why the source is named here:
 * if that file changes, this table has to change with it.
 *
 * Each cell says how much of a permission group a role holds: everything, some
 * of it, or none. The state is carried by an icon and a word in the accessible
 * name, never by colour alone.
 */

import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Page";
import {
  PERMISSION_GROUPS,
  RBAC_ROLES,
  matrixCoverage,
  type MatrixCoverage,
} from "@/features/admin/admin-utils";

const CELL: Record<MatrixCoverage, { icon: string; label: string; className: string }> = {
  all: { icon: "check-circle", label: "Full access", className: "text-rag-green" },
  some: { icon: "circle-dot", label: "Partial access", className: "text-rag-amber" },
  none: { icon: "minus", label: "No access", className: "text-ink-subtle" },
};

export function RbacMatrix() {
  return (
    <Panel title="Roles and permissions" icon="shield">
      <p className="mb-3 text-xs text-ink-muted">
        What each role can do. The server enforces this on every request, so a role cannot be given
        more access from the browser.
      </p>

      <div className="scroll-thin -mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">
            Permission groups held by each role: full, partial or none
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-2 py-2.5 text-left text-2xs font-semibold tracking-wide text-ink-muted uppercase">
                Role
              </th>
              {PERMISSION_GROUPS.map((group) => (
                <th
                  key={group.id}
                  scope="col"
                  className="px-2 py-2.5 text-center text-2xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  {group.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RBAC_ROLES.map((role) => (
              <tr key={role} className="border-b border-line last:border-0">
                <th scope="row" className="px-2 py-2.5 text-left font-medium text-ink">
                  {role}
                </th>
                {PERMISSION_GROUPS.map((group) => {
                  const coverage = matrixCoverage(role, group);
                  const cell = CELL[coverage];
                  return (
                    <td key={group.id} className="px-2 py-2.5 text-center">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon
                          name={cell.icon}
                          size={15}
                          className={cell.className}
                          label={`${role}: ${cell.label} to ${group.label}`}
                        />
                        <span className="sr-only">
                          {cell.label} to {group.label}
                        </span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-3 flex flex-wrap gap-3 text-2xs text-ink-muted">
        <li className="flex items-center gap-1.5">
          <Icon name="check-circle" size={14} className="text-rag-green" />
          Full — every permission in the group
        </li>
        <li className="flex items-center gap-1.5">
          <Icon name="circle-dot" size={14} className="text-rag-amber" />
          Partial — some of the group
        </li>
        <li className="flex items-center gap-1.5">
          <Icon name="minus" size={14} className="text-ink-subtle" />
          None
        </li>
      </ul>

      <div className="mt-4 space-y-2">
        {PERMISSION_GROUPS.map((group) => (
          <details key={group.id} className="rounded-[var(--radius-control)] border border-line px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-ink">
              {group.label}
              <span className="ml-2 font-normal text-ink-subtle">{group.description}</span>
            </summary>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {group.permissions.map((permission) => (
                <li key={permission}>
                  <Chip className="font-mono">{permission}</Chip>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-2xs text-ink-subtle">
        <Icon name="info" size={13} className="mt-0.5 shrink-0" />
        Transcribed from the server's role matrix. An Administrator deliberately cannot verify or
        close an obligation — that separation of duties is a control, not an oversight.
      </p>
    </Panel>
  );
}
