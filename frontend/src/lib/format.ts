/**
 * Display formatting. The database stores UTC; the users are in India, so
 * every timestamp is rendered in IST (Asia/Kolkata) — requirements RT-10 and
 * the PRD's data-residency section both depend on this being consistent.
 */

import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

const IST = "Asia/Kolkata";

/** Parses either a plain `YYYY-MM-DD` date or a full ISO timestamp. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  // A bare date is a calendar date, not an instant — parse it as local so it
  // never slips a day through a timezone conversion.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : parseISO(value);
  return isValid(date) ? date : null;
}

/** `04 Oct 2026` — the house format for every date in the UI. */
export function formatDate(value: string | Date | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? format(date, "dd MMM yyyy") : fallback;
}

/**
 * A bare calendar date read as an instant, for the formatters that pin IST.
 *
 * `toDate` parses a bare date as *local* midnight, which is right for
 * `formatDate` — it hands the same calendar date straight back. But a timestamp
 * formatter renders in IST, so a viewer east of IST would see local midnight
 * converted backwards and the date printed a day early. A due date shown one
 * day out is the one error this register must not make, so a bare date is
 * anchored to IST midnight instead.
 */
function toIstInstant(value: string | Date | null | undefined): Date | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00+05:30`);
  }
  return toDate(value);
}

/** `04 Oct 2026, 23:54` — timestamps, shown in IST. */
export function formatDateTime(value: string | Date | null | undefined, fallback = "—") {
  const date = toIstInstant(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** `23:54 IST` — for dense table cells. */
export function formatTimeIst(value: string | Date | null | undefined, fallback = "—") {
  const date = toIstInstant(value);
  if (!date) return fallback;
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${time} IST`;
}

/**
 * Today as an IST calendar date, `YYYY-MM-DD` — the shape the API filters take.
 *
 * The device clock is not the establishment's clock: a browser an hour behind
 * IST is still on yesterday's date during the first five and a half hours of
 * the Indian morning. `en-CA` renders `YYYY-MM-DD`, so no reassembly is needed.
 */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(now);
}

/** `2 hours ago` — for activity feeds and the notification bell. */
export function formatRelative(value: string | Date | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? formatDistanceToNowStrict(date, { addSuffix: true }) : fallback;
}

/**
 * The countdown wording used on every register row.
 *
 * Reading "-60" in a table means nothing to a compliance officer; "Expired
 * 60 days ago" does. Nulls are meaningful — a perpetual licence has no
 * countdown at all.
 */
export function formatCountdown(daysLeft: number | null | undefined): string {
  if (daysLeft === null || daysLeft === undefined) return "No expiry";
  if (daysLeft === 0) return "Expires today";
  if (daysLeft < 0) {
    const days = Math.abs(daysLeft);
    return `Expired ${days} day${days === 1 ? "" : "s"} ago`;
  }
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
}

/** Indian numbering — a yard's fee challans run into lakhs. */
export function formatMoney(value: number | null | undefined, fallback = "—") {
  if (value === null || value === undefined) return fallback;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, fallback = "—") {
  if (value === null || value === undefined) return fallback;
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** exponent;
  return `${size.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/**
 * Turns `UNDER_PROCESS`, `under process` or `status_change` into `Under Process`.
 *
 * Values reach the UI in three different casings — enums written as sentences
 * ("Due for Renewal"), database action names written as `snake_case`, and
 * occasional shouting — so the function normalises rather than only
 * capitalising: without the initial lower-casing, a perfectly good
 * `"Due for Renewal"` would come back as `"Due For Renewal"`.
 *
 * Two exceptions keep the result readable. Short all-caps tokens survive as
 * acronyms (`"MFA_ENABLED"` is `"MFA Enabled"`, not `"Mfa Enabled"`), and
 * short joining words stay lower-case unless they open or close the phrase.
 */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of",
  "on", "or", "per", "the", "to", "via", "vs",
]);

export function titleCase(value: string | null | undefined) {
  if (!value) return "";
  const words = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().split(" ");
  if (words.length === 1 && words[0] === "") return "";

  return words
    .map((word, index) => {
      // A two-to-four letter shout is an acronym the author meant to keep.
      if (word.length >= 2 && word.length <= 4 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word;
      }
      const lower = word.toLowerCase();
      const isEdge = index === 0 || index === words.length - 1;
      if (!isEdge && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** `R2 · Department-wise Status` — report labels. */
export function reportLabel(code: string, name: string) {
  return `${code} · ${name}`;
}

/** Truncates a long obligation name for a table cell, keeping its start. */
export function truncate(value: string, max = 64) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Initials for the avatar bubble. */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
