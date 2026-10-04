/**
 * Formatting is the layer every screen reads through, so its edge cases are
 * tested here rather than discovered on a dashboard.
 *
 * The timezone assertions matter: the database stores UTC, the users are in
 * India, and a renewal that slips a day through a timezone conversion is a
 * missed statutory deadline (PRD §13, "Time/Locale: IST").
 */

import { describe, expect, it } from "vitest";

import {
  formatCountdown,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTimeIst,
  initials,
  titleCase,
  todayIst,
  truncate,
} from "@/lib/format";

describe("formatCountdown", () => {
  it("says there is no countdown at all for a perpetual item", () => {
    expect(formatCountdown(null)).toBe("No expiry");
    expect(formatCountdown(undefined)).toBe("No expiry");
  });

  it("treats zero as today, not as a day remaining", () => {
    expect(formatCountdown(0)).toBe("Expires today");
  });

  it("uses the singular for a single day in either direction", () => {
    expect(formatCountdown(1)).toBe("1 day left");
    expect(formatCountdown(-1)).toBe("Expired 1 day ago");
  });

  it("uses the plural for several days", () => {
    expect(formatCountdown(30)).toBe("30 days left");
    expect(formatCountdown(-60)).toBe("Expired 60 days ago");
  });
});

describe("formatDate", () => {
  it("renders a bare calendar date in the house format", () => {
    expect(formatDate("2026-10-04")).toBe("04 Oct 2026");
  });

  it("falls back for a missing value", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("renders a UTC instant in IST (UTC+5:30)", () => {
    // 18:24 UTC is 23:54 the same evening in Kolkata.
    expect(formatDateTime("2026-10-04T18:24:00Z")).toBe("04 Oct 2026, 23:54");
  });

  it("rolls the IST date forward when UTC is still the previous day", () => {
    // 20:00 UTC on the 3rd is 01:30 IST on the 4th.
    expect(formatDateTime("2026-10-03T20:00:00Z")).toBe("04 Oct 2026, 01:30");
  });

  it("returns the fallback when there is no timestamp", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("formatTimeIst", () => {
  it("appends the IST marker", () => {
    expect(formatTimeIst("2026-10-04T18:24:00Z")).toBe("23:54 IST");
  });
});

describe("bare calendar dates read as IST instants", () => {
  it("reads a bare date as IST midnight, not the device's midnight", () => {
    // Only an actual IST device makes a local-midnight parse agree with this;
    // anywhere else the timestamp formatter would print a different hour — and,
    // east of IST, a different day, which is a due date shown early.
    expect(formatDateTime("2026-07-01")).toBe("01 Jul 2026, 00:00");
    expect(formatTimeIst("2026-07-01")).toBe("00:00 IST");
  });

  it("means exactly the instant IST midnight really is", () => {
    // 00:00 IST on 1 July is 18:30 UTC on 30 June — the calendar date is what
    // the register means, and this is the instant it stands for.
    expect(formatDateTime("2026-07-01")).toBe(formatDateTime("2026-06-30T18:30:00Z"));
    expect(formatDateTime("2026-07-01").slice(0, 11)).toBe(formatDate("2026-07-01"));
  });
});

describe("todayIst", () => {
  it("is the IST day, which is already tomorrow while UTC is still yesterday", () => {
    // 20:30 UTC on 9 March is 02:00 IST on the 10th.
    expect(todayIst(new Date("2026-03-09T20:30:00Z"))).toBe("2026-03-10");
  });

  it("hands back the shape the API filters take", () => {
    expect(todayIst(new Date("2026-07-01T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatMoney", () => {
  it("groups in the Indian numbering system, not the western one", () => {
    expect(formatMoney(1234567)).toContain("12,34,567");
    expect(formatMoney(1234567)).not.toContain("1,234,567");
  });

  it("uses the rupee symbol and no paise", () => {
    expect(formatMoney(9250)).toBe("₹9,250");
  });

  it("falls back for a missing fee", () => {
    expect(formatMoney(null)).toBe("—");
  });
});

describe("small helpers", () => {
  it("formats numbers with Indian grouping", () => {
    expect(formatNumber(1234567)).toBe("12,34,567");
  });

  it("turns a lower-case or underscored label into title case", () => {
    expect(titleCase("under process")).toBe("Under Process");
    expect(titleCase("on-hold")).toBe("On Hold");
    expect(titleCase("UNDER_PROCESS")).toBe("Under Process");
    expect(titleCase("status_change")).toBe("Status Change");
  });

  it("leaves an already display-cased value alone", () => {
    // The enums arrive ready to show; normalising must not undo them.
    expect(titleCase("Due for Renewal")).toBe("Due for Renewal");
    expect(titleCase("end of financial year")).toBe("End of Financial Year");
  });

  it("keeps short all-caps tokens as acronyms", () => {
    expect(titleCase("MFA_ENABLED")).toBe("MFA Enabled");
    expect(titleCase("PF")).toBe("PF");
    expect(titleCase("GST return filed")).toBe("GST Return Filed");
  });

  it("truncates a long name with an ellipsis", () => {
    const long = "A".repeat(80);
    expect(truncate(long, 10)).toHaveLength(10);
    expect(truncate(long, 10).endsWith("…")).toBe(true);
  });

  it("takes at most two initials", () => {
    expect(initials("Sandeep Rao")).toBe("SR");
    expect(initials("Meena")).toBe("M");
  });
});
