/**
 * Obligation categories — a two-level tree that groups the register and colours
 * the dashboard charts. Each category carries a colour, which is why the editor
 * offers a palette rather than a free-text field alone.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CountBadge } from "@/components/ui/Chip";
import { EmptyState, ErrorState, useToast } from "@/components/ui/Feedback";
import { Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateAdmin } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import type { CategoryRow } from "@/features/admin/admin-types";

/** Colours drawn from the chart series tokens, so a category matches its chart. */
const PALETTE = [
  "#2563eb",
  "#0891b2",
  "#059669",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#475569",
];

interface FormState {
  name: string;
  parent_id: string;
  colour: string;
  sort_order: string;
}

const EMPTY: FormState = { name: "", parent_id: "", colour: PALETTE[0], sort_order: "0" };

export function CategoriesTab() {
  const { can } = useAuth();
  const canManage = can(PERM.MANAGE_ORG);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: qk.org.categories,
    queryFn: () => api<CategoryRow[]>("/org/categories"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api<CategoryRow>(`/org/categories/${editing.id}`, { method: "PATCH", json: payload })
        : api<CategoryRow>("/org/categories", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success(editing ? "Category updated" : "Category created");
      void queryClient.invalidateQueries({ queryKey: qk.org.categories });
      void queryClient.invalidateQueries({ queryKey: qk.org.lookups });
      invalidateAdmin(queryClient);
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not save the category", error.detail);
      } else {
        toast.error("Could not save the category");
      }
    },
  });

  const openCreate = (parent?: CategoryRow) => {
    setEditing(null);
    setForm({ ...EMPTY, parent_id: parent?.id ?? "" });
    setErrors({});
    setOpen(true);
  };

  const openEdit = (row: CategoryRow) => {
    setEditing(row);
    setForm({
      name: row.name,
      parent_id: row.parent_id ?? "",
      colour: row.colour ?? PALETTE[0],
      sort_order: String(row.sort_order),
    });
    setErrors({});
    setOpen(true);
  };

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (form.name.trim().length < 2) nextErrors.name = "Give the category a name of at least 2 characters.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    mutation.mutate({
      name: form.name.trim(),
      parent_id: form.parent_id || null,
      colour: form.colour.trim() || null,
      sort_order: Number(form.sort_order) || 0,
    });
  };

  const roots = query.data ?? [];

  /** Every id that could be a parent — but a category may not parent itself. */
  const parentOptions = roots.flatMap((root) => [
    { value: root.id, label: root.name, disabled: root.id === editing?.id },
    ...(root.children ?? []).map((child) => ({
      value: child.id,
      label: `— ${child.name}`,
      // The API has no depth guard, so keep the picker to the two known levels.
      disabled: true,
    })),
  ]);

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Categories</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              Categories group the register and set the colour used on dashboards.
            </p>
          </div>
          {canManage && (
            <Button variant="primary" icon="plus" size="sm" onClick={() => openCreate()}>
              New category
            </Button>
          )}
        </div>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <div className="p-4 sm:p-5">
            <p className="text-sm text-ink-muted">Loading categories…</p>
          </div>
        ) : roots.length === 0 ? (
          <EmptyState
            icon="columns"
            title="No categories yet"
            description="Add a category to group the register and colour the dashboards."
            action={
              canManage ? (
                <Button variant="primary" icon="plus" onClick={() => openCreate()}>
                  New category
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {roots.map((root) => (
              <li key={root.id}>
                <CategoryRowView
                  row={root}
                  canManage={canManage}
                  onEdit={openEdit}
                  onAddChild={(parent) => openCreate(parent)}
                />
                {root.children.length > 0 && (
                  <ul className="divide-y divide-line border-t border-line bg-surface-muted/40">
                    {root.children.map((child) => (
                      <li key={child.id}>
                        <CategoryRowView
                          row={child}
                          indent
                          canManage={canManage}
                          onEdit={openEdit}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit category" : "New category"}
        description="Categories are shown in filters, reports and the template library."
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
              {editing ? "Save changes" : "Create category"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required error={errors.name}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. Factory licences"
              />
            )}
          </Field>
          <Field
            label="Parent category"
            hint="Leave empty for a top-level category"
          >
            {({ id }) => (
              <Select
                id={id}
                value={form.parent_id}
                placeholder="Top level"
                options={parentOptions}
                onChange={(event) => setForm({ ...form, parent_id: event.target.value })}
              />
            )}
          </Field>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-ink">Colour</p>
            <div className="flex flex-wrap items-center gap-2">
              {PALETTE.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  aria-label={`Use colour ${colour}`}
                  aria-pressed={form.colour.toLowerCase() === colour.toLowerCase()}
                  onClick={() => setForm({ ...form, colour })}
                  className="size-8 rounded-full border-2 transition-transform hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-offset-1"
                  style={{
                    backgroundColor: colour,
                    borderColor:
                      form.colour.toLowerCase() === colour.toLowerCase()
                        ? "var(--color-ink)"
                        : "transparent",
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span
                aria-hidden
                className="size-9 shrink-0 rounded-[var(--radius-control)] border border-line"
                style={{ backgroundColor: form.colour }}
              />
              <Input
                aria-label="Colour hex value"
                value={form.colour}
                onChange={(event) => setForm({ ...form, colour: event.target.value })}
                placeholder="#2563eb"
                className="w-32"
              />
              <p className="text-2xs text-ink-subtle">
                Used for the rail dot and dashboard series.
              </p>
            </div>
          </div>

          <Field label="Sort order" hint="Lower numbers appear first">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                value={form.sort_order}
                onChange={(event) => setForm({ ...form, sort_order: event.target.value })}
                className="w-28"
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}

function CategoryRowView({
  row,
  indent = false,
  canManage,
  onEdit,
  onAddChild,
}: {
  row: CategoryRow;
  indent?: boolean;
  canManage: boolean;
  onEdit: (row: CategoryRow) => void;
  onAddChild?: (parent: CategoryRow) => void;
}) {
  return (
    <div className={indent ? "flex items-center gap-3 py-2.5 pr-4 pl-9 sm:pr-5" : "flex items-center gap-3 px-4 py-3 sm:px-5"}>
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full border border-line"
        style={{ backgroundColor: row.colour ?? "var(--color-line-strong)" }}
      />
      <div className="min-w-0 flex-1">
        <p className={indent ? "truncate text-xs text-ink-muted" : "truncate text-sm font-medium text-ink"}>
          {row.name}
        </p>
        {!indent && row.parent_name && (
          <p className="text-2xs text-ink-subtle">Under {row.parent_name}</p>
        )}
      </div>
      <CountBadge value={row.item_count} />
      <span className="tabular hidden w-10 text-right text-2xs text-ink-subtle sm:inline">
        #{row.sort_order}
      </span>
      {canManage && (
        <div className="flex gap-1.5">
          {onAddChild && (
            <Button
              size="sm"
              variant="ghost"
              icon="plus"
              aria-label={`Add a sub-category under ${row.name}`}
              onClick={() => onAddChild(row)}
            />
          )}
          <Button
            size="sm"
            icon="edit"
            aria-label={`Edit ${row.name}`}
            onClick={() => onEdit(row)}
          />
        </div>
      )}
    </div>
  );
}
