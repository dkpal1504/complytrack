/**
 * Saved views (CD-10).
 *
 * `GET /items/saved-views` returns the shared, system presets. There is no
 * endpoint to create one — the API has no POST for saved views — so a view the
 * user saves is kept in this browser's localStorage and merged with the server
 * list for display. The stored shape is deliberately the same as the server's,
 * so a preset the API grows into a real record would drop straight in.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Feedback";
import { Field, Input } from "@/components/ui/Form";
import { Modal, ConfirmDialog } from "@/components/ui/Overlay";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";
import { useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/cn";
import type { SavedView, RegisterFilters } from "@/features/register/api-types";

const STORAGE_KEY = "complytrack.register.savedViews";

/** The filter keys a saved view is allowed to carry. */
const FILTER_KEYS: (keyof RegisterFilters)[] = [
  "search",
  "unit_id",
  "department_id",
  "category_id",
  "criticality",
  "type",
  "owner_id",
  "tag",
  "derived_status",
  "rag",
  "status",
  "expiring_days",
  "include_archived",
  "sort",
  "direction",
];

function readLocal(): SavedView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedView[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // Private browsing, or a corrupted entry.
  }
}

function writeLocal(views: SavedView[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    /* Storage unavailable — the view simply is not remembered. */
  }
}

/**
 * Turns a saved view's filter object into the register's own filter patch.
 *
 * The server's "My items" preset carries `mine: true` rather than an owner id,
 * so it is translated to the signed-in user's id — the register API has no
 * `mine` parameter. Keys the register does not understand are dropped rather
 * than sent to an API that would ignore them anyway.
 */
export function viewToPatch(
  filters: Record<string, unknown>,
  userId: string | undefined,
): Partial<RegisterFilters> {
  const patch: Partial<RegisterFilters> = {};
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value === undefined || value === null || value === "") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (patch as Record<string, unknown>)[key] = value as any;
  }
  if (filters.mine === true && userId) patch.owner_id = userId;
  return patch;
}

export interface RegisterSavedViewsProps {
  currentFilters: RegisterFilters;
  onApply: (patch: Partial<RegisterFilters>) => void;
}

export function RegisterSavedViews({ currentFilters, onApply }: RegisterSavedViewsProps) {
  const toast = useToast();
  const { user } = useAuth();
  const [local, setLocal] = useState<SavedView[]>(() => readLocal());
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);

  const server = useQuery({
    queryKey: qk.items.savedViews,
    queryFn: () => api<SavedView[]>("/items/saved-views"),
    staleTime: 10 * 60_000,
  });

  const views = useMemo<SavedView[]>(
    () => [...(server.data ?? []), ...local],
    [server.data, local],
  );

  const apply = (view: SavedView) => {
    onApply(viewToPatch(view.filters, user?.id));
    setAppliedKey(view.key);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const filters: Record<string, unknown> = {};
    for (const key of FILTER_KEYS) {
      const value = currentFilters[key];
      if (value === undefined || value === null || value === "" || value === false) continue;
      filters[key] = value;
    }
    const view: SavedView = {
      key: `local-${Date.now()}`,
      name: trimmed,
      columns: [],
      filters,
    };
    const next = [...local, view];
    setLocal(next);
    writeLocal(next);
    setName("");
    setSaveOpen(false);
    toast.success("View saved", `“${trimmed}” is now one click away on this browser.`);
    apply(view);
  };

  const remove = (key: string) => {
    const next = local.filter((view) => view.key !== key);
    setLocal(next);
    writeLocal(next);
    if (appliedKey === key) setAppliedKey(null);
    setRemoveKey(null);
    toast.info("View removed");
  };

  const removeTarget = local.find((view) => view.key === removeKey) ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-4 py-2.5 sm:px-5">
        <span className="mr-1 text-2xs font-semibold tracking-wide text-ink-subtle uppercase">
          Saved views
        </span>
        {server.isPending && !views.length ? (
          <span className="text-2xs text-ink-subtle">Loading…</span>
        ) : (
          views.map((view) => {
            const isLocal = view.key.startsWith("local-");
            const active = appliedKey === view.key;
            return (
              <span key={view.key} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => apply(view)}
                  aria-pressed={active}
                  title="Apply this view"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs font-medium transition-colors",
                    active
                      ? "border-brand-300 bg-brand-600 text-white"
                      : "border-line bg-surface-muted text-ink-muted hover:border-brand-300 hover:text-ink",
                    isLocal && "rounded-r-none",
                  )}
                >
                  <Icon name={isLocal ? "save" : "filter"} size={11} />
                  {view.name}
                </button>
                {isLocal && (
                  <button
                    type="button"
                    onClick={() => setRemoveKey(view.key)}
                    aria-label={`Remove saved view ${view.name}`}
                    className={cn(
                      "rounded-r-full border border-l-0 px-1.5 py-0.5",
                      active
                        ? "border-brand-300 bg-brand-600 text-white"
                        : "border-line bg-surface-muted text-ink-subtle hover:text-rag-red",
                    )}
                  >
                    <Icon name="x" size={11} />
                  </button>
                )}
              </span>
            );
          })
        )}

        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          className="ml-auto"
          onClick={() => setSaveOpen(true)}
        >
          Save current view
        </Button>
        {local.length > 0 && (
          <Chip icon="info" title="Views you save are stored in this browser only">
            {local.length} saved here
          </Chip>
        )}
      </div>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save this view"
        description="Keeps the filters currently applied to the register."
        size="sm"
        footer={
          <>
            <Button onClick={() => setSaveOpen(false)} block className="sm:w-auto">
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="save"
              onClick={save}
              disabled={!name.trim()}
              block
              className="sm:w-auto"
            >
              Save view
            </Button>
          </>
        }
      >
        <Field label="Name" required hint="e.g. Main Shipyard — critical, due in 30 days">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this view"
            />
          )}
        </Field>
        <p className="mt-3 text-2xs text-ink-subtle">
          Saved views live in this browser — the API has no endpoint to create a shared one, so
          nothing here is visible to your colleagues.
        </p>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeKey)}
        onClose={() => setRemoveKey(null)}
        onConfirm={() => removeKey && remove(removeKey)}
        title="Remove this saved view?"
        confirmLabel="Remove"
        message={
          <>
            “{removeTarget?.name}” will be dropped from this browser. The register itself is not
            affected.
          </>
        }
      />
    </>
  );
}
