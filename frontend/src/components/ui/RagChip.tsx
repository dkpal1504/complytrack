/**
 * RAG as a chip.
 *
 * The dashboards and the worklists all need to show the red/amber/green band
 * beside a row. A dot alone is not a label — a colour-blind reader, or anyone
 * reading a print-out, gets nothing from it — so the chip carries a word as
 * well, with the full band description in the tooltip.
 */

import { RagDot } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";
import { RAG_LABEL } from "@/lib/status";
import type { Rag } from "@/types/api";

const RAG_CHIP: Record<Rag, string> = {
  red: "bg-rag-red-bg text-rag-red border-rag-red-border",
  amber: "bg-rag-amber-bg text-rag-amber border-rag-amber-border",
  green: "bg-rag-green-bg text-rag-green border-rag-green-border",
  grey: "bg-rag-grey-bg text-rag-grey border-rag-grey-border",
};

/** The short form, for a dense table cell. */
const RAG_SHORT: Record<Rag, string> = {
  red: "Breach",
  amber: "Due soon",
  green: "On track",
  grey: "N/A",
};

export function RagChip({ rag, className }: { rag: Rag; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium whitespace-nowrap",
        RAG_CHIP[rag] ?? RAG_CHIP.grey,
        className,
      )}
      title={RAG_LABEL[rag]}
    >
      <RagDot rag={rag} />
      {RAG_SHORT[rag] ?? rag}
    </span>
  );
}
