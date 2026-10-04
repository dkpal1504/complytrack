/**
 * Departments — master data for the `department_id` scoping rule and the
 * default owner of an obligation.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CountBadge } from "@/components/ui/Chip";
import { ErrorState, useToast } from "@/components/ui/Feedback";
import { Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { DataTable, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateAdmin } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { useLookups, toOptions } from "@/features/org/useReference";
import type { DepartmentRow } from "@/features/admin/admin-types";

interface FormState {
  code: string;
  name: string;
  head_user_id: string;
  unit_id: string;
}

const EMPTY: FormState = { code: "", name: "", head_user_id: "", unit_id: "" };

export function DepartmentsTab() {
  const { can } = useAuth();
  const canManage = can(PERM.MANAGE_ORG);
  const queryClient = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: qk.org.departments,
    queryFn: () => api<DepartmentRow[]>("/org/departments"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api<DepartmentRow>(`/org/departments/${editing.id}`, { method: "PATCH", json: payload })
        : api<DepartmentRow>("/org/departments", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success(editing ? "Department updated" : "Department created");
      void queryClient.invalidateQueries({ queryKey: qk.org.departments });
      void queryClient.invalidateQueries({ queryKey: qk.org.lookups });
      invalidateAdmin(queryClient);
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not save the department", error.detail);
      } else {
        toast.error("Could not save the department");
      }
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setErrors({});
    setOpen(true);
  };

  const openEdit = (row: DepartmentRow) => {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name,
      head_user_id: row.head_user_id ?? "",
      unit_id: row.unit_id ?? "",
    });
    setErrors({});
    setOpen(true);
  };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "Give the department a name.";
    if (!editing && !form.code.trim()) nextErrors.code = "A department code is required.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      head_user_id: form.head_user_id || null,
      unit_id: form.unit_id || null,
    };
    if (!editing) payload.code = form.code.trim();
    mutation.mutate(payload);
  };

  const columns: Column<DepartmentRow>[] = [
    {
      key: "name",
      header: "Department",
      isTitle: true,
      sortValue: (row) => row.name,
      cell: (row) => <span className="font-medium text-ink">{row.name}</span>,
    },
    {
      key: "code",
      header: "Code",
      sortValue: (row) => row.code,
      cell: (row) => <span className="tabular">{row.code}</span>,
    },
    {
      key: "head",
      header: "Head",
      hideBelow: "md",
      mobileLabel: "Head",
      sortValue: (row) => row.head_user_name,
      cell: (row) => row.head_user_name ?? "—",
    },
    {
      key: "unit",
      header: "Unit",
      hideBelow: "lg",
      sortValue: (row) => row.unit_name,
      cell: (row) => row.unit_name ?? "—",
    },
    {
      key: "users",
      header: "People",
      align: "right",
      sortValue: (row) => row.user_count,
      cell: (row) => <CountBadge value={row.user_count} />,
    },
    {
      key: "items",
      header: "Obligations",
      align: "right",
      hideBelow: "sm",
      sortValue: (row) => row.item_count,
      cell: (row) => <CountBadge value={row.item_count} />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      mobileLabel: "Actions",
      cell: (row) =>
        canManage ? (
          <Button size="sm" icon="edit" onClick={() => openEdit(row)}>
            Edit
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Departments</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              A Department User sees only the obligations owned by their own department.
            </p>
          </div>
          {canManage && (
            <Button variant="primary" icon="plus" size="sm" onClick={openCreate}>
              New department
            </Button>
          )}
        </div>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption="Departments"
            columns={columns}
            rows={query.data ?? []}
            getRowId={(row) => row.id}
            loading={query.isPending}
            empty={
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                No departments yet. Add one for each team that owns obligations.
              </p>
            }
          />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit department" : "New department"}
        description="Departments drive the default owner and the scoped view."
        footer={
          <>
            <Button onClick={() => setOpen(false)} className="sm:w-auto" block>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="save"
              onClick={submit}
              loading={mutation.isPending}
              className="sm:w-auto"
              block
            >
              {editing ? "Save changes" : "Create department"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Code"
            required={!editing}
            error={errors.code}
            hint={editing ? "Cannot be changed" : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.code}
                disabled={Boolean(editing)}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                placeholder="SAFETY"
              />
            )}
          </Field>
          <Field label="Name" required error={errors.name}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            )}
          </Field>
          <Field label="Department head">
            {({ id }) => (
              <Select
                id={id}
                value={form.head_user_id}
                placeholder="No head assigned"
                options={toOptions(lookups.data?.users)}
                onChange={(event) => setForm({ ...form, head_user_id: event.target.value })}
              />
            )}
          </Field>
          <Field label="Unit">
            {({ id }) => (
              <Select
                id={id}
                value={form.unit_id}
                placeholder="All units"
                options={toOptions(lookups.data?.units)}
                onChange={(event) => setForm({ ...form, unit_id: event.target.value })}
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}
