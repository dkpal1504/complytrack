/**
 * Users and access administration.
 *
 * Four things live here because they answer one question: who can see and do
 * what. The directory provisions accounts, the access review is the auditor's
 * flat extract, the orphan list catches obligations whose owner left, and the
 * matrix explains the roles themselves.
 *
 * The API paginates and searches server-side but cannot filter by unit, so the
 * directory is loaded up to the server's maximum page and filtered in the
 * browser — that keeps one filter set that composes (unit *and* status *and*
 * search) instead of a unit filter that would silently apply to one page only.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, ErrorState, useToast } from "@/components/ui/Feedback";
import { SearchInput, Select } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Tabs } from "@/components/ui/Nav";
import { PageHeader, ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, Pagination, type Column } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useDebouncedValue, useUrlFilters } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { useLookups, toOptions } from "@/features/org/useReference";
import { RBAC_ROLES, USER_STATUSES } from "@/features/admin/admin-utils";
import { UserFormModal } from "@/features/admin/UserFormModal";
import { ResetPasswordDialog, TemporaryPasswordDialog } from "@/features/admin/ResetPasswordDialog";
import { AccessReviewPanel } from "@/features/admin/AccessReviewPanel";
import { OrphansPanel } from "@/features/admin/OrphansPanel";
import { RbacMatrix } from "@/features/admin/RbacMatrix";
import type { OrphansResponse } from "@/features/admin/admin-types";
import type { Paginated, UserSummary } from "@/types/api";

/** The server caps `page_size` at 500; the directory is loaded in one go. */
const DIRECTORY_LIMIT = 500;

/**
 * One shared empty list rather than a fresh `[]` each render.
 *
 * The filtered list and the paged slice are both keyed on the rows; a new array
 * identity on every render while the directory is loading would make both
 * recompute on every render.
 */
const NO_USERS: UserSummary[] = [];

export default function UsersPage() {
  const { can } = useAuth();
  const canManage = can(PERM.MANAGE_ORG);
  const toast = useToast();
  const lookups = useLookups();

  const { filters, setFilter, reset, activeCount, page, pageSize, setPage, setPageSize } =
    useUrlFilters({
      tab: "accounts",
      search: "",
      role: "",
      unit: "",
      department_id: "",
      status: "",
    });

  const tab = String(filters.tab ?? "accounts");

  const [searchText, setSearchText] = useState(String(filters.search ?? ""));
  const debouncedSearch = useDebouncedValue(searchText, 300);

  useEffect(() => {
    if (debouncedSearch !== filters.search) setFilter("search", debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: qk.users.list({ page: 1, page_size: DIRECTORY_LIMIT }),
    queryFn: () =>
      api<Paginated<UserSummary>>("/users", { query: { page: 1, page_size: DIRECTORY_LIMIT } }),
  });

  /** Shares a query key with the panel below, so this costs no extra request. */
  const orphans = useQuery({
    queryKey: qk.users.orphans,
    queryFn: () => api<OrphansResponse>("/users/orphans"),
  });

  const unitNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const unit of lookups.data?.units ?? []) map.set(unit.id, unit.name);
    return map;
  }, [lookups.data]);

  const rows = query.data?.items ?? NO_USERS;
  const truncated = (query.data?.total ?? 0) > rows.length;

  const filtered = useMemo(() => {
    const needle = String(filters.search ?? "").trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.role && row.role !== filters.role) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.department_id && row.department_id !== filters.department_id) return false;
      if (filters.unit && !(row.unit_ids ?? []).includes(String(filters.unit))) return false;
      if (needle) {
        const haystack = [row.name, row.email, row.employee_id].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, filters.search, filters.role, filters.status, filters.department_id, filters.unit]);

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );
  const pages = Math.max(Math.ceil(filtered.length / pageSize), 1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [resetting, setResetting] = useState<UserSummary | null>(null);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const orphanCount = orphans.data?.total ?? 0;
  const accountCount = query.data?.total ?? 0;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (row: UserSummary) => {
    setEditing(row);
    setFormOpen(true);
  };

  const columns: Column<UserSummary>[] = [
    {
      key: "name",
      header: "Name",
      isTitle: true,
      sortValue: (row) => row.name,
      cell: (row) => <span className="font-medium text-ink">{row.name}</span>,
    },
    {
      key: "email",
      header: "Email",
      hideBelow: "md",
      mobileLabel: "Email",
      sortValue: (row) => row.email,
      cell: (row) => <span className="truncate">{row.email}</span>,
    },
    {
      key: "employee_id",
      header: "Employee ID",
      hideBelow: "xl",
      sortValue: (row) => row.employee_id,
      cell: (row) => <span className="tabular">{row.employee_id ?? "—"}</span>,
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
      hideBelow: "xl",
      mobileLabel: "Units",
      cell: (row) => {
        const names = (row.unit_ids ?? []).map((id) => unitNames.get(id) ?? id);
        if (names.length === 0) return "—";
        if (names.length <= 2) return names.join(", ");
        return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
      },
    },
    {
      key: "role",
      header: "Role",
      sortValue: (row) => row.role,
      cell: (row) => <Chip icon="shield">{row.role}</Chip>,
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
          <Icon name="shield-check" size={15} className="text-rag-green" label="Two-factor enabled" />
        ) : (
          <Icon name="minus" size={15} className="text-ink-subtle" label="Two-factor not enabled" />
        ),
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
    {
      key: "actions",
      header: "Actions",
      align: "right",
      mobileLabel: "Actions",
      className: "whitespace-nowrap",
      cell: (row) =>
        canManage ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" icon="edit" onClick={() => openEdit(row)} aria-label={`Edit ${row.name}`}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="lock"
              onClick={() => setResetting(row)}
              aria-label={`Reset the password for ${row.name}`}
            >
              Reset
            </Button>
          </div>
        ) : null,
    },
  ];

  const tabs = [
    { id: "accounts", label: "Accounts", icon: "users" as const, count: accountCount },
    ...(orphanCount > 0
      ? [
          {
            id: "orphans",
            label: "Orphans",
            icon: "user-cog" as const,
            count: orphanCount,
            tone: "warning" as const,
          },
        ]
      : [{ id: "orphans", label: "Orphans", icon: "user-cog" as const }]),
    { id: "review", label: "Access review", icon: "shield-check" as const },
    { id: "matrix", label: "Roles & permissions", icon: "shield" as const },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Users and access"
        description="Provision accounts, review who can reach what, and fix obligations left behind when someone leaves."
        actions={
          canManage ? (
            <Button variant="primary" icon="user-plus" onClick={openCreate} className="sm:w-auto" block>
              New user
            </Button>
          ) : undefined
        }
        tabs={
          <Tabs
            items={tabs}
            value={tabs.some((item) => item.id === tab) ? tab : "accounts"}
            onChange={(id) => setFilter("tab", id)}
            className="px-4 sm:px-6"
          />
        }
      />

      <div className="p-4 sm:p-6">
        {tab === "accounts" && (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
            <Toolbar label="User filters">
              <SearchInput
                value={searchText}
                onChange={setSearchText}
                placeholder="Search name, email or employee ID…"
                className="sm:w-72"
              />
              <Select
                aria-label="Role"
                value={String(filters.role ?? "")}
                placeholder="Any role"
                options={RBAC_ROLES.map((value) => ({ value, label: value }))}
                onChange={(event) => setFilter("role", event.target.value)}
              />
              <Select
                aria-label="Unit"
                value={String(filters.unit ?? "")}
                placeholder="Any unit"
                options={toOptions(lookups.data?.units)}
                onChange={(event) => setFilter("unit", event.target.value)}
              />
              <Select
                aria-label="Department"
                value={String(filters.department_id ?? "")}
                placeholder="Any department"
                options={toOptions(lookups.data?.departments)}
                onChange={(event) => setFilter("department_id", event.target.value)}
              />
              <Select
                aria-label="Status"
                value={String(filters.status ?? "")}
                placeholder="Any status"
                options={USER_STATUSES.map((value) => ({ value, label: value }))}
                onChange={(event) => setFilter("status", event.target.value)}
              />
              {activeCount > 0 && (
                <Button size="sm" variant="ghost" icon="x" onClick={reset}>
                  Clear filters
                </Button>
              )}
            </Toolbar>

            {truncated && (
              <p
                role="status"
                className="flex items-start gap-2 border-b border-line bg-rag-amber-bg px-4 py-2 text-2xs text-rag-amber sm:px-5"
              >
                <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
                This directory holds {query.data?.total} accounts; the first {rows.length} are shown
                and filtered here. Narrow the list by department or role to work at full scale.
              </p>
            )}

            {query.error ? (
              <ErrorState error={query.error} onRetry={() => void query.refetch()} />
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5 sm:px-5">
                  <ResultCount shown={pageRows.length} total={filtered.length} noun="account" />
                </div>
                <DataTable
                  caption="User accounts"
                  columns={columns}
                  rows={pageRows}
                  getRowId={(row) => row.id}
                  loading={query.isPending}
                  empty={
                    <EmptyState
                      icon="users"
                      title="No accounts match these filters"
                      description={
                        activeCount > 0
                          ? "Try clearing a filter to widen the list."
                          : "No accounts have been created yet."
                      }
                      action={
                        activeCount > 0 ? (
                          <Button onClick={reset}>Clear filters</Button>
                        ) : canManage ? (
                          <Button variant="primary" icon="user-plus" onClick={openCreate}>
                            New user
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                />
                <Pagination
                  page={page}
                  pages={pages}
                  total={filtered.length}
                  pageSize={pageSize}
                  onPage={setPage}
                  onPageSize={setPageSize}
                />
              </>
            )}
          </div>
        )}

        {tab === "orphans" && <OrphansPanel />}
        {tab === "review" && <AccessReviewPanel units={unitNames} />}
        {tab === "matrix" && <RbacMatrix />}
      </div>

      <UserFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        user={editing}
        onCreated={(email, temporaryPassword) => {
          toast.success("Account created", `${email} can sign in once they set a password.`);
          void query.refetch();
          if (temporaryPassword) setIssued({ email, password: temporaryPassword });
        }}
      />

      <ResetPasswordDialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        user={resetting}
      />

      <TemporaryPasswordDialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        email={issued?.email ?? ""}
        password={issued?.password ?? ""}
      />
    </div>
  );
}
