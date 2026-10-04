import { cn } from "@/lib/cn";

/** The standard surface: one card, one subject. */
export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

// The native `title` attribute is a string; this header takes a node, so the
// inherited one has to go or the interface cannot extend it.
export interface CardHeaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned actions; wraps below the title on narrow screens. */
  actions?: React.ReactNode;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  ...rest
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5",
        className,
      )}
      {...rest}
    >
      <div className="min-w-0">
        <h2 className="text-lg leading-tight font-semibold text-ink">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}

export function CardBody({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-4 sm:p-5", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A labelled group with a heading, used to break up long forms. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {description && <p className="text-sm text-ink-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
