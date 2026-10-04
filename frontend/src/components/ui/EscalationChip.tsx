/**
 * The escalation level as a chip.
 *
 * The officer worklist and the dashboards both show how far an obligation has
 * climbed the escalation ladder (OW-04). The level is meaningless as a bare
 * number to anyone but an administrator, so the chip spells out who has been
 * told as well as the colour.
 */

import { Chip } from "@/components/ui/Chip";

const LEVEL_LABEL: Record<number, string> = {
  0: "Reminder to owner",
  1: "Department head notified",
  2: "Unit head and compliance notified",
  3: "Plant head / management notified",
  4: "Director / CEO notified",
};

const LEVEL_CHIP: Record<number, string> = {
  1: "bg-status-under-process/10 text-status-under-process border-status-under-process/30",
  2: "bg-rag-amber-bg text-rag-amber border-rag-amber-border",
  3: "bg-rag-red-bg text-rag-red border-rag-red-border",
  4: "bg-rag-red-bg text-rag-red border-rag-red-border",
};

/** A short label for a dense table cell. */
export function escalationShort(level: number): string {
  if (!level) return "None";
  if (level >= 4) return "Director";
  if (level === 3) return "Plant head";
  if (level === 2) return "Unit head";
  return "Dept head";
}

export function EscalationChip({ level, className }: { level: number; className?: string }) {
  const level0 = Number.isFinite(level) ? Math.max(0, Math.trunc(level)) : 0;
  if (level0 === 0) {
    return (
      <Chip icon="minus" className={className} title="No escalation">
        None
      </Chip>
    );
  }
  return (
    <Chip
      icon="arrow-up-right"
      className={LEVEL_CHIP[level0] ?? LEVEL_CHIP[3]}
      title={LEVEL_LABEL[level0] ?? `Escalation level ${level0}`}
    >
      Level {level0}
    </Chip>
  );
}
