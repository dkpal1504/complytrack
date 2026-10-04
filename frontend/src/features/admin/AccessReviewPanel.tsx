/**
 * Access review (AC-07).
 *
 * A flat read-only extract of every account and what it can reach — the
 * evidence an IT auditor asks for. Nothing here is editable: the review reads
 * the same rows the directory does, and any change is made on the directory
 * tab where it is audited.
 */

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ErrorState } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query";
import type { AccessReviewRow } from "@/features/admin/admin-types";

export function AccessReviewPanel({ units }: { units: Map<string, string> }) {
  const query = useQuery({
    queryKey: qk.users.accessReview,
    queryFn: () => api<AccessReviewRow[]>("/users/access-review"),
  });

  const columns: Column<AccessReviewRow>[] = [
    {
      key: "name",
      header: "Account",
      isTitle: true,
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.name}</p>
          <p className="truncate text-2xs text-ink-subtle">{row.email}</p>
        </div>
      ),
    },
    {
      key: "employee",
      header: "Employee ID",
      hideBelow: "xl",
      sortValue: (row) => row.employee_id,
      cell: (row) => <span className="tabular">{row.employee_id ?? "—"}</span>,
    },
    {
      key: "role",
      header: "Role",
      sortValue: (row) => row.role,
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {(row.roles.length > 0 ? row.roles : [row.role]).map((role) => (
            <Chip key={role} icon="shield">
              {role}
            </Chip>
          ))}
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      hideBelow: "lg",
      sortValue: (row) => row.department_name,
      cell: (row) => row.department_name ?? "—",
    },
    {
      key: "units",
      header: "Units",
      hideBelow: "lg",
      mobileLabel: "Units",
      cell: (row) => {
        const names = row.unit_names.length
          ? row.unit_names
          : row.unit_ids.map((id) => units.get(id) ?? id);
        return names.length ? names.join(", ") : "—";
      },
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      cell: (row) =>
        row.status === "Active" ? (
          <Chip icon="check">Active</Chip>
        ) : (
          <Chip icon="pause">{row.status}</Chip>
        ),
    },
    {
      key: "mfa",
      header: "MFA",
      align: "center",
      hideBelow: "md",
      sortValue: (row) => (row.mfa_enabled ? 0 : 1),
      cell: (row) =>
        row.mfa_enabled ? (
          <span title="Two-factor enabled">
            <Icon name="shield-check" size={15} className="text-rag-green" label="Enabled" />
          </span>
        ) : (
          <span title="No two-factor">
            <Icon name="minus" size={15} className="text-ink-subtle" label="Not enabled" />
          </span>
        ),
    },
    {
      key: "must_change",
      header: "Must change",
      align: "center",
      hideBelow: "xl",
      mobileLabel: "Must change",
      sortValue: (row) => (row.must_change_password ? 0 : 1),
      cell: (row) => (row.must_change_password ? "Yes" : "No"),
    },
    {
      key: "items",
      header: "Owns",
      align: "right",
      sortValue: (row) => row.items_owned,
      cell: (row) => <span className="tabular">{row.items_owned}</span>,
    },
    {
      key: "last_login",
      header: "Last sign-in",
      hideBelow: "xl",
      mobileLabel: "Last sign-in",
      sortValue: (row) => row.last_login_at,
      cell: (row) =>
        row.last_login_at ? (
          <span className="tabular">{formatDateTime(row.last_login_at)}</span>
        ) : (
          <span className="text-ink-subtle">Never</span>
        ),
    },
  ];

  return (
    <Panel
      title="Access review"
      icon="shield-check"
      actions={
        <Button size="sm" icon="refresh" onClick={() => void query.refetch()}>
          Refresh
        </Button>
      }
    >
      <p className="mb-3 text-xs text-ink-muted">
        Who holds which role, which units they can see and whether they still sign in. This is a
        read-only extract; change an account on the Accounts tab.
      </p>
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption="Access review of every account"
          columns={columns}
          rows={query.data ?? []}
          getRowId={(row) => row.id}
          loading={query.isPending}
          empty={<p className="py-6 text-center text-sm text-ink-muted">No accounts found.</p>}
        />
      )}
    </Panel>
  );
}
