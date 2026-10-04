/**
 * The status vocabulary is what keeps the register, the dashboards and the
 * charts speaking one language. A missing entry would silently degrade a chip
 * to plain text and drop a series out of a stacked bar, so completeness is
 * asserted against the TypeScript unions.
 */

import { describe, expect, it } from "vitest";

import { BUCKET_STYLES, CHART_SERIES, CRITICALITY_CHIP, STATUS_STYLES, indexRag } from "@/lib/status";
import type { ComplianceBucket, ItemStatus, Rag } from "@/types/api";

/* Typing these arrays as the unions is the compile-time half of the check:
   dropping a member from a union makes this file fail to type-check. */
const BUCKETS: ComplianceBucket[] = [
  "Complied",
  "Under Process",
  "Pending",
  "Overdue",
  "Expired",
];

const STATUSES: ItemStatus[] = [
  "Pending",
  "Under Process",
  "Submitted",
  "Renewed",
  "Closed",
  "Query Raised",
  "On Hold",
  "Not Applicable",
];

describe("indexRag", () => {
  it("bands a high index as green at the 90 boundary", () => {
    expect(indexRag(90)).toBe<Rag>("green");
    expect(indexRag(100)).toBe<Rag>("green");
  });

  it("bands just below 90 as amber", () => {
    expect(indexRag(89.9)).toBe<Rag>("amber");
  });

  it("bands a middling index as amber down to the 75 boundary", () => {
    expect(indexRag(75)).toBe<Rag>("amber");
  });

  it("bands just below 75 as red", () => {
    expect(indexRag(74.9)).toBe<Rag>("red");
    expect(indexRag(0)).toBe<Rag>("red");
  });
});

describe("BUCKET_STYLES", () => {
  it("covers every compliance bucket exactly once", () => {
    expect(Object.keys(BUCKET_STYLES).sort()).toEqual([...BUCKETS].sort());
  });

  it("gives every bucket a label, a chip, an icon and a chart colour", () => {
    for (const bucket of BUCKETS) {
      const style = BUCKET_STYLES[bucket];
      expect(style.label).toBe(bucket);
      expect(style.chip.length).toBeGreaterThan(0);
      expect(style.icon.length).toBeGreaterThan(0);
      expect(style.solid.startsWith("var(--color-")).toBe(true);
    }
  });
});

describe("STATUS_STYLES", () => {
  it("covers every workflow status exactly once", () => {
    expect(Object.keys(STATUS_STYLES).sort()).toEqual([...STATUSES].sort());
  });

  it("gives every status a label, a chip, an icon and a chart colour", () => {
    for (const status of STATUSES) {
      const style = STATUS_STYLES[status];
      expect(style.label).toBe(status);
      expect(style.chip.length).toBeGreaterThan(0);
      expect(style.icon.length).toBeGreaterThan(0);
      expect(style.solid.startsWith("var(--color-")).toBe(true);
    }
  });
});

describe("CHART_SERIES", () => {
  it("stacks exactly the buckets, in palette order, with matching colours", () => {
    expect(CHART_SERIES.map((series) => series.key)).toEqual(BUCKETS);
    for (const series of CHART_SERIES) {
      expect(series.color).toBe(BUCKET_STYLES[series.key].solid);
    }
  });
});

describe("CRITICALITY_CHIP", () => {
  it("has a chip style for every criticality", () => {
    for (const level of ["Critical", "High", "Medium", "Low"]) {
      expect(CRITICALITY_CHIP[level]).toBeTruthy();
    }
  });
});
