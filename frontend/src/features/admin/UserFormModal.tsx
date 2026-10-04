/**
 * Create or edit a user account.
 *
 * A user has one primary role, one department and any number of units. The
 * units matter: they are half of the data scope, so a Department User with no
 * unit sees an empty register — the form says so rather than letting it happen
 * silently.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Overlay";
import { Section } from "@/components/ui/Card";
import { api, ApiError } from "@/lib/api";
import { invalidateAdmin } from "@/lib/query";
import { useLookups, toOptions } from "@/features/org/useReference";
import { RBAC_ROLES, USER_STATUSES } from "@/features/admin/admin-utils";
import type { UserSummary } from "@/types/api";

interface FormState {
  name: string;
  email: string;
  mobile: string;
  employee_id: string;
  department_id: string;
  unit_ids: string[];
  role: string;
  status: string;
  mfa_enabled: boolean;
  password: string;
}

const EMPTY: FormState = {
  name: "",
  email: "",
  mobile: "",
  employee_id: "",
  department_id: "",
  unit_ids: [],
  role: "Department User",
  status: "Active",
  mfa_enabled: false,
  password: "",
};

/** `POST /users` returns the generated password; `PATCH` returns the hand-over count. */
interface SaveResult {
  temporary_password?: string | null;
  orphan_items?: number;
}

export function UserFormModal({
  open,
  onClose,
  user,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` to create, a row to edit. */
  user: UserSummary | null;
  /** Receives the generated temporary password when the server created one. */
  onCreated: (email: string, temporaryPassword: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const lookups = useLookups(open);
  const isEdit = user !== null;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setForm(EMPTY);
      setErrors({});
      return;
    }
    if (!user) {
      setForm(EMPTY);
      return;
    }
    setForm({
      name: user.name,
      email: user.email,
      mobile: user.mobile ?? "",
      employee_id: user.employee_id ?? "",
      department_id: user.department_id ?? "",
      unit_ids: user.unit_ids ?? [],
      role: user.role,
      status: user.status,
      mfa_enabled: user.mfa_enabled,
      password: "",
    });
  }, [open, user]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? api<SaveResult>(`/users/${user.id}`, { method: "PATCH", json: payload })
        : api<SaveResult>("/users", { method: "POST", json: payload }),
    onSuccess: (result: SaveResult) => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      invalidateAdmin(queryClient);
      if (isEdit) {
        const orphans = result.orphan_items ?? 0;
        toast.success(
          "Account updated",
          orphans > 0
            ? `This person still owns ${orphans} open obligation${orphans === 1 ? "" : "s"} — reassign them on the Orphans list.`
            : undefined,
        );
        onClose();
      } else {
        onClose();
        onCreated(form.email.trim().toLowerCase(), result.temporary_password ?? null);
      }
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.byField);
        toast.error("Could not save the account", error.detail);
      } else {
        toast.error("Could not save the account");
      }
    },
  });

  const submit = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "Give the person a name.";
    if (!form.email.trim()) nextErrors.email = "An email address is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = "That does not look like an email address.";
    }
    if (!isEdit && form.password && form.password.length < 8) {
      nextErrors.password = "A password must be at least 8 characters.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      mobile: form.mobile.trim() || null,
      employee_id: form.employee_id.trim() || null,
      department_id: form.department_id || null,
      unit_ids: form.unit_ids,
      role: form.role,
      status: form.status,
      mfa_enabled: form.mfa_enabled,
    };
    if (form.password) payload.password = form.password;
    mutation.mutate(payload);
  };

  const toggleUnit = (unitId: string, checked: boolean) =>
    setForm((current) => ({
      ...current,
      unit_ids: checked
        ? [...current.unit_ids, unitId]
        : current.unit_ids.filter((id) => id !== unitId),
    }));

  const units = lookups.data?.units ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? "Edit user" : "New user"}
      description={
        isEdit
          ? "Setting the status to Inactive signs the person out immediately and flags their open obligations."
          : "Leave the password empty and the system generates a temporary one to hand over."
      }
      footer={
        <>
          <Button onClick={onClose} className="sm:w-auto" block>
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
            {isEdit ? "Save changes" : "Create account"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Section title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={errors.name}>
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
            <Field label="Email" required error={errors.email}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="email"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              )}
            </Field>
            <Field label="Mobile">
              {({ id }) => (
                <Input
                  id={id}
                  value={form.mobile}
                  onChange={(event) => setForm({ ...form, mobile: event.target.value })}
                />
              )}
            </Field>
            <Field label="Employee ID">
              {({ id }) => (
                <Input
                  id={id}
                  value={form.employee_id}
                  onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
                />
              )}
            </Field>
          </div>
        </Section>

        <Section title="Access">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" hint="One primary role per account">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.role}
                  options={RBAC_ROLES.map((value) => ({ value, label: value }))}
                  onChange={(event) => setForm({ ...form, role: event.target.value })}
                />
              )}
            </Field>
            <Field label="Department">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.department_id}
                  placeholder="No department"
                  options={toOptions(lookups.data?.departments)}
                  onChange={(event) => setForm({ ...form, department_id: event.target.value })}
                />
              )}
            </Field>
            <Field label="Status">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.status}
                  options={USER_STATUSES.map((value) => ({ value, label: value }))}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                />
              )}
            </Field>
            {!isEdit && (
              <Field
                label="Initial password"
                hint="Optional — leave blank to generate"
                error={errors.password}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    type="text"
                    autoComplete="new-password"
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                  />
                )}
              </Field>
            )}
          </div>

          <fieldset className="mt-1">
            <legend className="text-xs font-semibold text-ink">Units in scope</legend>
            <p className="mt-0.5 mb-2 text-2xs text-ink-subtle">
              A Department User sees only obligations in these units. Administrator and Compliance
              roles see every unit regardless.
            </p>
            {units.length === 0 ? (
              <p className="text-xs text-ink-muted">No units have been created yet.</p>
            ) : (
              <div className="scroll-thin grid max-h-44 gap-2 overflow-y-auto rounded-[var(--radius-control)] border border-line p-3 sm:grid-cols-2">
                {units.map((unit) => (
                  <Checkbox
                    key={unit.id}
                    label={unit.name}
                    checked={form.unit_ids.includes(unit.id)}
                    onChange={(event) => toggleUnit(unit.id, event.target.checked)}
                  />
                ))}
              </div>
            )}
          </fieldset>

          <Switch
            checked={form.mfa_enabled}
            onChange={(next) => setForm({ ...form, mfa_enabled: next })}
            label="Require two-factor authentication"
            description="The account must confirm a code from an authenticator app at sign-in."
          />
        </Section>
      </div>
    </Modal>
  );
}
