/**
 * The legal reference library — the Act, rule or section behind an obligation.
 *
 * The API exposes this as an append-only list (`GET` and `POST` only), so this
 * tab offers search and "add", and says plainly that entries cannot be edited
 * or removed once recorded.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState, useToast } from "@/components/ui/Feedback";
import { Field, Input, SearchInput, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { ResultCount, Toolbar } from "@/components/ui/Page";
import { DataTable, type Column } from "@/components/ui/Table";
import { api, ApiError } from "@/lib/api";
import { qk, invalidateAdmin } from "@/lib/query";
import { PERM, useAuth } from "@/features/auth/auth-context";
import type { LegalReferenceRow } from "@/features/admin/admin-types";

interface FormState {
  act_rule_name: string;
  section: string;
  jurisdiction: string;
  description: string;
}

const EMPTY: FormState = { act_rule_name: "", section: "", jurisdiction: "", description: "" };

export function LegalReferencesTab() {
  const { can } = useAuth();
  const canManage = can(PERM.MANAGE_ORG);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: qk.org.legalReferences,
    queryFn: () => api<LegalReferenceRow[]>("/org/legal-references"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<LegalReferenceRow>("/org/legal-references", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success("Legal reference added");
      void queryClient.invalidateQueries({ queryKey: qk.org.legalReferences });
      invalidateAdmin(queryClient);
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not add the reference", error.detail);
      } else {
        toast.error("Could not add the reference");
      }
    },
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return query.data ?? [];
    return (query.data ?? []).filter((row) =>
      [row.act_rule_name, row.section, row.jurisdiction, row.description]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle)),
    );
  }, [query.data, search]);

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (form.act_rule_name.trim().length < 2) {
      nextErrors.act_rule_name = "Give the Act or rule a name of at least 2 characters.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    mutation.mutate({
      act_rule_name: form.act_rule_name.trim(),
      section: form.section.trim() || null,
      jurisdiction: form.jurisdiction.trim() || null,
      description: form.description.trim() || null,
    });
  };

  const columns: Column<LegalReferenceRow>[] = [
    {
      key: "act",
      header: "Act or rule",
      isTitle: true,
      sortValue: (row) => row.act_rule_name,
      cell: (row) => (
        <span className="block max-w-[24rem] font-medium text-ink">{row.act_rule_name}</span>
      ),
    },
    {
      key: "section",
      header: "Section",
      sortValue: (row) => row.section,
      cell: (row) => row.section ?? "—",
    },
    {
      key: "jurisdiction",
      header: "Jurisdiction",
      hideBelow: "md",
      sortValue: (row) => row.jurisdiction,
      cell: (row) => row.jurisdiction ?? "—",
    },
    {
      key: "description",
      header: "Description",
      hideBelow: "lg",
      mobileLabel: "Description",
      cell: (row) => (
        <span className="block max-w-[28rem] text-ink-muted">{row.description ?? "—"}</span>
      ),
    },
  ];

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Legal references</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">
              Attach these to a template so the register cites its source. Entries are recorded as
              added and cannot be changed afterwards.
            </p>
          </div>
          {canManage && (
            <Button
              variant="primary"
              icon="plus"
              size="sm"
              onClick={() => {
                setForm(EMPTY);
                setErrors({});
                setOpen(true);
              }}
            >
              Add reference
            </Button>
          )}
        </div>

        <Toolbar label="Legal reference filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search Act, section or description…"
            className="sm:w-80"
          />
          <ResultCount shown={filtered.length} total={query.data?.length ?? 0} noun="reference" />
        </Toolbar>

        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            caption="Legal references"
            columns={columns}
            rows={filtered}
            getRowId={(row) => row.id}
            loading={query.isPending}
            empty={
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                {search
                  ? "No legal reference matches that search."
                  : "No legal references yet. Add the Act or rule behind your obligations."}
              </p>
            }
          />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add legal reference"
        description="Once recorded, a reference cannot be edited or removed."
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
              Add reference
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Act or rule" required error={errors.act_rule_name}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.act_rule_name}
                onChange={(event) => setForm({ ...form, act_rule_name: event.target.value })}
                placeholder="e.g. Factories Act, 1948"
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Section" hint="e.g. Section 6">
              {({ id }) => (
                <Input
                  id={id}
                  value={form.section}
                  onChange={(event) => setForm({ ...form, section: event.target.value })}
                />
              )}
            </Field>
            <Field label="Jurisdiction" hint="Central, state or local">
              {({ id }) => (
                <Input
                  id={id}
                  value={form.jurisdiction}
                  onChange={(event) => setForm({ ...form, jurisdiction: event.target.value })}
                  placeholder="e.g. Gujarat"
                />
              )}
            </Field>
          </div>
          <Field label="Description">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={3}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="What the provision requires."
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}
