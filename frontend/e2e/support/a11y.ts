/**
 * The axe scan, shared by the two specs that run one.
 *
 * Kept in one place so both screens are judged by the same standard, and so a
 * failure reads the same way wherever it is found: rule id, how many nodes,
 * and what the rule is for.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The PRD's stated standard. Contrast is part of it, on the real palette. */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

interface Violation {
  id: string;
  help: string;
  impact?: string | null;
  nodes: unknown[];
}

function describe(violations: Violation[]) {
  return violations
    .map((violation) => `${violation.id} (${violation.nodes.length}): ${violation.help}`)
    .join("\n");
}

/**
 * Scans a rendered screen and fails on anything a person would notice.
 *
 * Only serious and critical: "moderate" mostly covers advisories this product
 * has no way to act on, and a suite that fails on those stops being read.
 */
export async function expectNoSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  const blocking = violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking, `\n${describe(blocking)}`).toEqual([]);
}
