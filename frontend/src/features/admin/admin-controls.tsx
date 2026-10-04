/**
 * Two small editors the administration forms share.
 *
 * Both are labelled regions with a real keyboard path: a text/number box plus
 * an explicit Add button, and each chip has its own remove button with an
 * `aria-label` naming the value it removes.
 */

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, Input } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";

/** Add/remove editor for a list of short strings, e.g. required documents. */
export function StringListEditor({
  label,
  hint,
  values,
  onChange,
  placeholder = "Add an item…",
  addLabel = "Add",
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <Field label={label} hint={hint} className="flex-1">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={draft}
              placeholder={placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
          )}
        </Field>
        <Button onClick={add} icon="plus" className="shrink-0">
          {addLabel}
        </Button>
      </div>
      {values.length === 0 ? (
        <p className="text-2xs text-ink-subtle">Nothing added yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value}>
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-muted py-0.5 pr-1 pl-2 text-2xs text-ink">
                {value}
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  onClick={() => onChange(values.filter((entry) => entry !== value))}
                  className="rounded-full p-0.5 text-ink-subtle hover:bg-surface hover:text-ink"
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Add/remove editor for day offsets, shown as read-only chips. */
export function NumberListEditor({
  label,
  hint,
  values,
  onChange,
  placeholder = "e.g. 30",
  addLabel = "Add offset",
}: {
  label: string;
  hint?: string;
  values: number[];
  onChange: (next: number[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      setDraft("");
      return;
    }
    if (!values.includes(parsed)) onChange([...values, parsed].sort((a, b) => b - a));
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <Field label={label} hint={hint} className="w-32 shrink-0">
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="number"
              aria-describedby={describedBy}
              value={draft}
              placeholder={placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
          )}
        </Field>
        <Button onClick={add} icon="plus" className="shrink-0">
          {addLabel}
        </Button>
      </div>
      {values.length === 0 ? (
        <p className="text-2xs text-ink-subtle">No offsets — this profile sends nothing.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value}>
              <Chip>
                {value === 0 ? "On due date" : value > 0 ? `${value} days before` : `${-value} days overdue`}
                <button
                  type="button"
                  aria-label={`Remove ${value} day offset`}
                  onClick={() => onChange(values.filter((entry) => entry !== value))}
                  className="ml-1 rounded-full p-0.5 text-ink-subtle hover:bg-surface hover:text-ink"
                >
                  <Icon name="x" size={12} />
                </button>
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
