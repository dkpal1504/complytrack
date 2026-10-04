import { forwardRef } from "react";
import { Link } from "react-router-dom";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white border-transparent hover:bg-brand-700 active:bg-brand-800 shadow-sm",
  secondary:
    "bg-surface text-ink border-line-strong hover:bg-surface-muted active:bg-surface-muted",
  ghost:
    "bg-transparent text-ink-muted border-transparent hover:bg-surface-muted hover:text-ink",
  danger: "bg-rag-red text-white border-transparent hover:opacity-90 active:opacity-80",
  success: "bg-rag-green text-white border-transparent hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-10 px-3.5 text-sm gap-2",
  lg: "h-12 px-5 text-base gap-2.5",
  // A 44px square: the minimum comfortable touch target on a tablet in a yard.
  icon: "h-11 w-11 p-0",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  /** Renders a full-width button, which is the right default on a phone. */
  block?: boolean;
}

/**
 * The one button in the product.
 *
 * Disabled and loading states keep the same width so a toolbar never reflows
 * mid-click — a small thing that makes a dense screen feel stable.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    icon,
    iconRight,
    loading = false,
    block = false,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const iconSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border font-medium",
        "transition-colors duration-150 select-none",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : (
        icon && <Icon name={icon} size={iconSize} />
      )}
      {children && <span className={cn(size === "icon" && "sr-only")}>{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
});

export interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  block?: boolean;
}

/** A button that navigates. Same look, correct semantics. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  icon,
  block,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const iconSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;
  return (
    <Link
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius-control)] border font-medium",
        "transition-colors duration-150",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
    </Link>
  );
}
