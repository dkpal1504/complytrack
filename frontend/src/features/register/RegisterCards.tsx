/**
 * The register as RAG-grouped cards.
 *
 * The table answers "what is the value in column nine"; this view answers
 * "what is on fire". Rows are grouped into the four RAG bands — red first, so
 * the breaches are at the top — and each card carries only the four facts a
 * supervisor needs at a glance: what it is, how critical, when it falls due and
 * where it stands.
 */

import { Link } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { CriticalityChip, DerivedStatusChip, RagDot } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/Feedback";
import { formatCountdown, formatDate } from "@/lib/format";
import { RAG_LABEL } from "@/lib/status";
import { cn } from "@/lib/cn";
import type { Rag } from "@/types/api";
import type { RegisterRow } from "@/features/register/api-types";

const BAND_ORDER: Rag[] = ["red", "amber", "green", "grey"];

const BAND_TONE: Record<Rag, string> = {
  red: "border-rag-red-border",
  amber: "border-rag-amber-border",
  green: "border-rag-green-border",
  grey: "border-line",
};

const COUNTDOWN_TONE: Record<Rag, string> = {
  red: "text-rag-red",
  amber: "text-rag-amber",
  green: "text-rag-green",
  grey: "text-ink-muted",
};

export interface RegisterCardsProps {
  rows: RegisterRow[];
  /** Shows the selection checkbox; hidden when the role cannot act in bulk. */
  selectable?: boolean;
  selectedIds?: string[];
  onToggle?: (id: string) => void;
  empty?: React.ReactNode;
}

export function RegisterCards({
  rows,
  selectable = false,
  selectedIds = [],
  onToggle,
  empty,
}: RegisterCardsProps) {
  if (!rows.length) {
    return (
      <>
        {empty ?? (
          <EmptyState
            icon="search"
            title="No obligations match these filters"
            description="Try widening the date range or clearing a filter."
          />
        )}
      </>
    );
  }

  const bands = BAND_ORDER.map((rag) => ({
    rag,
    rows: rows.filter((row) => row.rag === rag),
  })).filter((band) => band.rows.length > 0);

  return (
    <div className="space-y-6">
      {bands.map((band) => (
        <section key={band.rag} aria-label={`${RAG_LABEL[band.rag]} (${band.rows.length})`}>
          <div className="mb-2.5 flex items-center gap-2">
            <RagDot rag={band.rag} />
            <h2 className="text-sm font-semibold text-ink">{RAG_LABEL[band.rag]}</h2>
            <span className="tabular text-xs text-ink-muted">{band.rows.length}</span>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {band.rows.map((row) => {
              const selected = selectedIds.includes(row.id);
              return (
                <li key={row.id}>
                  <Card
                    className={cn(
                      "flex h-full flex-col p-3.5 transition-shadow hover:shadow-[var(--shadow-raised)]",
                      BAND_TONE[row.rag],
                      selected && "ring-2 ring-brand-500/40",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => onToggle?.(row.id)}
                          aria-label={`Select ${row.name}`}
                          className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-600)]"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/items/${row.id}`}
                          className="block hover:underline"
                        >
                          <p className="tabular text-2xs font-semibold tracking-wide text-ink-subtle">
                            {row.item_code}
                          </p>
                          <p className="mt-0.5 text-sm leading-snug font-medium text-ink">
                            {row.name}
                          </p>
                        </Link>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <CriticalityChip criticality={row.criticality} />
                      <DerivedStatusChip status={row.current_status} />
                      {row.is_perpetual && (
                        <span className="text-2xs text-ink-subtle">Perpetual</span>
                      )}
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <div className="min-w-0">
                        <dt className="text-2xs tracking-wide text-ink-subtle uppercase">Unit</dt>
                        <dd className="truncate text-ink">{row.unit_name ?? "—"}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-2xs tracking-wide text-ink-subtle uppercase">Owner</dt>
                        <dd className="truncate text-ink">{row.owner_name ?? "Unassigned"}</dd>
                      </div>
                    </dl>

                    <p
                      className={cn(
                        "mt-auto pt-3 text-xs font-medium",
                        COUNTDOWN_TONE[row.rag],
                      )}
                    >
                      {formatCountdown(row.days_left)}
                      {row.expiry_date && (
                        <span className="ml-1 font-normal text-ink-subtle">
                          · {formatDate(row.expiry_date)}
                        </span>
                      )}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
