/**
 * Form controls.
 *
 * Every control is label-first, error-adjacent and keyboard reachable, and
 * every input is at least 44px tall on a touch screen. Errors are announced
 * with `aria-describedby` so a screen reader reads the problem with the field.
 */

import { forwardRef, useId } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

const CONTROL =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm text-ink " +
  "placeholder:text-ink-subtle transition-colors duration-150 " +
  "hover:border-brand-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-subtle";

export function Label({
  children,
  htmlFor,
  required,
  hint,
  className,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-1.5 flex items-baseline justify-between gap-2", className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold text-ink">
        {children}
        {required && (
          <span className="ml-0.5 text-rag-red" aria-hidden>
            *
          </span>
        )}
      </label>
      {hint && <span className="text-2xs text-ink-subtle">{hint}</span>}
    </div>
  );
}

export interface FieldProps {
  label: React.ReactNode;
  error?: string | null;
  hint?: React.ReactNode;
  required?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
  className?: string;
}

/** Wires a label, an error message and a control together correctly. */
export function Field({ label, error, hint, required, children, className }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id} required={required} hint={hint}>
        {label}
      </Label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error && (
        <p id={errorId} role="alert" className="mt-1 flex items-start gap-1 text-xs text-rag-red">
          <Icon name="alert-circle" size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-2xs text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  icon?: IconName;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, icon, className, ...rest },
  ref,
) {
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        "h-11 sm:h-10",
        icon && "pl-9",
        invalid && "border-rag-red focus:border-rag-red focus:ring-rag-red/25",
        className,
      )}
      {...rest}
    />
  );
  if (!icon) return control;
  return (
    <div className="relative">
      <Icon
        name={icon}
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
      />
      {control}
    </div>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        "py-2 leading-relaxed",
        invalid && "border-rag-red focus:border-rag-red focus:ring-rag-red/25",
        className,
      )}
      {...rest}
    />
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  placeholder?: string;
  options: { value: string; label: string; disabled?: boolean }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, placeholder, options, className, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL,
          "h-11 appearance-none pr-9 sm:h-10",
          invalid && "border-rag-red focus:border-rag-red focus:ring-rag-red/25",
          className,
        )}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevron-down"
        size={16}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-subtle"
      />
    </div>
  );
});

export function Checkbox({
  label,
  description,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: React.ReactNode;
  description?: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-line-strong text-brand-600 accent-[var(--color-brand-600)] focus:ring-brand-500/30"
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-ink select-none">
          {label}
        </label>
        {description && <p className="text-2xs text-ink-subtle">{description}</p>}
      </div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="text-2xs text-ink-subtle">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-brand-600" : "bg-line-strong",
        )}
      >
        <span
          className={cn(
            "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[1.375rem]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** A debounced search box — the register's primary entry point. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cn("relative", className)}>
      <Icon
        name="search"
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
      />
      <input
        type="search"
        role="searchbox"
        value={value}
        // The caller decides: autofocus belongs on a search box that opens with
        // a keyboard shortcut, not on every search field on a page.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(CONTROL, "h-11 pr-9 pl-9 sm:h-10")}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-ink"
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

/** A read-only key/value pair for detail panels. */
export function DescriptionItem({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-2xs font-semibold tracking-wide text-ink-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-ink">{children ?? "—"}</dd>
    </div>
  );
}
