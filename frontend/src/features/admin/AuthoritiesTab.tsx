/**
 * Issuing authorities — the body that grants or receives a filing. The
 * `default_processing_days` here is the fallback when a template does not set
 * its own, and it feeds the "start preparation by" date.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, CountBadge } from "@/components/ui/Chip";
import { ErrorState, useToast } from "@/components/ui/Feedback";
import { Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { DataTable, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateAdmin } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import { AUTHORITY_LEVELS } from "@/features/admin/admin-utils";
import type { AuthorityRow } from "@/features/admin/admin-types";

interface FormState {
  name: string;
  level: string;
  website: string;
  contact: string;
  default_processing_days: string;
}

const EMPTY: FormState = {
  name: "",
  level: "State",
  website: "",
  contact: "",
  default_processing_days: "15",
};

export function AuthoritiesTab() {
  const { can } = useAuth();
  const canManage = can(PERM.MANAGE_ORG);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AuthorityRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: qk.org.authorities,
    queryFn: () => api<AuthorityRow[]>("/org/authorities"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api<AuthorityRow>(`/org/authorities/${editing.id}`, { method: "PATCH", json: payload })
        : api<AuthorityRow>("/org/authorities", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success(editing ? "Authority updated" : "Authority created");
      void queryClient.invalidateQueries({ queryKey: qk.org.authorities });
      void queryClient.invalidateQueries({ queryKey: qk.org.lookups });
      invalidateAdmin(queryClient);
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not save the authority", error.detail);
      } else {
        toast.error("Could not save the authority");
      }
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setErrors({});
    setOpen(true);
  };

  const openEdit = (row: AuthorityRow) => {
    setEditing(row);
    setForm({
      name: row.name,
      level: row.level,
      website: row.website ?? "",
      contact: row.contact ?? "",
      default_processing_days: String(row.default_processing_days),
    });
    setErrors({});
    setOpen(true);
  };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (form.name.trim().length < 2) nextErrors.name = "Give the authority a name of at least 2 characters.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    mutation.mutate({
      name: form.name.trim(),
      level: form.level,
      website: form.website.trim() || null,
      contact: form.contact.trim() || null,
      default_processing_days: Number(form.default_processing_days) || 15,
    });
  };

  const columns: Column<AuthorityRow>[] = [
    {
      key: "name",
      header: "Authority",
      isTitle: true,
      sortValue: (row) => row.name,
      cell: (row) => <span className="font-medium text-ink">{row.name}</span>,
    },
    {
      key: "level",
      header: "Level",
      sortValue: (row) => row.level,
      cell: (row) => <Chip>{row.level}</Chip>,
    },
    {
      key: "contact",
      header: "Contact",
      hideBelow: "lg",
      cell: (row) => row.contact ?? "—",
    },
    {
      key: "website",
      header: "Website",
      hideBelow: "xl",
      cell: (row) =>
        row.website ? (
          <a
            href={row.website}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand-700 hover:underline"
          >
            Portal
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "days",
      header: "Default processing",
      align: "right",
      hideBelow: "md",
      mobileLabel: "Processing",
      sortValue: (row) => row.default_processing_days,
      cell: (row) => `${row.default_processing_days} days`,
    },
    {
      key: "items",
      header: "Obligations",
      align: "right",
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
            <h2 className="text-sm font-semibold text-ink">Issuing authorities</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              The default processing time sets how early preparation begins when a template does not
              override it.
            </p>
          </div>
          {canManage && (
            <Button variant="primary" icon="plus" size="sm" onClick={openCreate}>
              New authority
            </Button>
          )}
        </div>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption="Issuing authorities"
            columns={columns}
            rows={query.data ?? []}
            getRowId={(row) => row.id}
            loading={query.isPending}
            empty={
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                No authorities yet. Add the bodies that issue your licences and receive your filings.
              </p>
            }
          />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit authority" : "New authority"}
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
              {editing ? "Save changes" : "Create authority"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name} className="sm:col-span-2">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. Gujarat Pollution Control Board"
              />
            )}
          </Field>
          <Field label="Level">
            {({ id }) => (
              <Select
                id={id}
                value={form.level}
                options={AUTHORITY_LEVELS.map((value) => ({ value, label: value }))}
                onChange={(event) => setForm({ ...form, level: event.target.value })}
              />
            )}
          </Field>
          <Field label="Default processing (days)">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={0}
                value={form.default_processing_days}
                onChange={(event) =>
                  setForm({ ...form, default_processing_days: event.target.value })
                }
              />
            )}
          </Field>
          <Field label="Website" hint="The authority's portal">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="url"
                value={form.website}
                onChange={(event) => setForm({ ...form, website: event.target.value })}
                placeholder="https://"
              />
            )}
          </Field>
          <Field label="Contact" hint="Phone, email or office address">
            {({ id }) => (
              <Input
                id={id}
                value={form.contact}
                onChange={(event) => setForm({ ...form, contact: event.target.value })}
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}
