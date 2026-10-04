/**
 * Organisation units (yards, plants, offices, subsidiaries) — master data for
 * every obligation's `unit_id`.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, CountBadge } from "@/components/ui/Chip";
import { ErrorState, useToast } from "@/components/ui/Feedback";
import { Field, Input, Select, Switch } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { DataTable, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateAdmin } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { UNIT_TYPES } from "@/features/admin/admin-utils";
import type { UnitRow } from "@/features/admin/admin-types";

interface FormState {
  code: string;
  name: string;
  type: string;
  parent_id: string;
  address: string;
  state: string;
  gstin: string;
  active: boolean;
}

const EMPTY: FormState = {
  code: "",
  name: "",
  type: "Yard",
  parent_id: "",
  address: "",
  state: "",
  gstin: "",
  active: true,
};

export function UnitsTab() {
  const { can } = useAuth();
  const canManage = can(PERM.MANAGE_ORG);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: qk.org.units,
    queryFn: () => api<UnitRow[]>("/org/units"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api<UnitRow>(`/org/units/${editing.id}`, { method: "PATCH", json: payload })
        : api<UnitRow>("/org/units", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success(editing ? "Unit updated" : "Unit created");
      void queryClient.invalidateQueries({ queryKey: qk.org.units });
      void queryClient.invalidateQueries({ queryKey: qk.org.lookups });
      invalidateAdmin(queryClient);
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not save the unit", error.detail);
      } else {
        toast.error("Could not save the unit");
      }
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setErrors({});
    setOpen(true);
  };

  const openEdit = (row: UnitRow) => {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name,
      type: row.type,
      parent_id: row.parent_id ?? "",
      address: row.address ?? "",
      state: row.state ?? "",
      gstin: row.gstin ?? "",
      active: row.active,
    });
    setErrors({});
    setOpen(true);
  };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "Give the unit a name.";
    if (!editing && !form.code.trim()) nextErrors.code = "A unit code is required.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      type: form.type,
      parent_id: form.parent_id || null,
      address: form.address.trim() || null,
      state: form.state.trim() || null,
      gstin: form.gstin.trim() || null,
      active: form.active,
    };
    if (!editing) payload.code = form.code.trim();
    mutation.mutate(payload);
  };

  const columns: Column<UnitRow>[] = [
    {
      key: "name",
      header: "Unit",
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
    { key: "type", header: "Type", hideBelow: "sm", sortValue: (row) => row.type, cell: (row) => row.type },
    {
      key: "state",
      header: "State",
      hideBelow: "lg",
      sortValue: (row) => row.state,
      cell: (row) => row.state ?? "—",
    },
    {
      key: "gstin",
      header: "GSTIN",
      hideBelow: "xl",
      cell: (row) => <span className="tabular">{row.gstin ?? "—"}</span>,
    },
    {
      key: "items",
      header: "Obligations",
      align: "right",
      sortValue: (row) => row.item_count,
      cell: (row) => <CountBadge value={row.item_count} />,
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => (row.active ? 0 : 1),
      cell: (row) =>
        row.active ? <Chip icon="check">Active</Chip> : <Chip icon="pause">Inactive</Chip>,
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

  const parentOptions = (query.data ?? []).map((row) => ({
    value: row.id,
    label: `${row.name} (${row.code})`,
    disabled: editing?.id === row.id,
  }));

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Organisation units</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              Every obligation belongs to one unit. Units also scope what a Department User can see.
            </p>
          </div>
          {canManage && (
            <Button variant="primary" icon="plus" size="sm" onClick={openCreate}>
              New unit
            </Button>
          )}
        </div>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption="Organisation units"
            columns={columns}
            rows={query.data ?? []}
            getRowId={(row) => row.id}
            loading={query.isPending}
            empty={
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                No units yet. Add the first yard or plant to start building the register.
              </p>
            }
          />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit unit" : "New unit"}
        description="Units appear in every register filter and scoping rule."
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
              {editing ? "Save changes" : "Create unit"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" required={!editing} error={errors.code} hint={editing ? "Cannot be changed" : undefined}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.code}
                  disabled={Boolean(editing)}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  placeholder="YARD"
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
            <Field label="Type">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.type}
                  options={UNIT_TYPES.map((value) => ({ value, label: value }))}
                  onChange={(event) => setForm({ ...form, type: event.target.value })}
                />
              )}
            </Field>
            <Field label="Parent unit" hint="For a subsidiary or satellite office">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.parent_id}
                  placeholder="No parent"
                  options={parentOptions}
                  onChange={(event) => setForm({ ...form, parent_id: event.target.value })}
                />
              )}
            </Field>
            <Field label="State" hint="Drives state-wise holiday calendars">
              {({ id }) => (
                <Input
                  id={id}
                  value={form.state}
                  onChange={(event) => setForm({ ...form, state: event.target.value })}
                  placeholder="Gujarat"
                />
              )}
            </Field>
            <Field label="GSTIN">
              {({ id }) => (
                <Input
                  id={id}
                  value={form.gstin}
                  onChange={(event) => setForm({ ...form, gstin: event.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label="Address">
            {({ id }) => (
              <Input
                id={id}
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            )}
          </Field>
          <Switch
            checked={form.active}
            onChange={(next) => setForm({ ...form, active: next })}
            label="Active"
            description="Inactive units stay in history but cannot receive new obligations."
          />
        </div>
      </Modal>
    </>
  );
}
