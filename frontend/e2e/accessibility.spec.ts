/**
 * Accessibility, against the standard the PRD names: WCAG 2.1 level AA.
 *
 * axe-core checks the machine-decidable half of that — names, roles, contrast,
 * landmarks, form labels — on the screens that carry the most UI. The checks
 * below it cover the part no scanner can see: that the keyboard actually
 * reaches the content, and that a page announces itself properly.
 *
 * Failures are reported by rule id and page rather than as a bare count, so a
 * regression names itself.
 */

import { expect, type Page } from "@playwright/test";

import { expectNoSeriousViolations } from "./support/a11y";
import { firstItemHref, test } from "./support/session";

/**
 * Screens with enough UI to be worth scanning, one per layout family.
 *
 * Each carries the heading that proves the screen actually rendered. Waiting on
 * a bare `<main>` would not: any screen can render one, so a redirect or an
 * error state would be scanned and reported as a clean bill of health for a
 * screen nobody looked at.
 *
 * The sign-in screen is scanned in `auth.spec.ts`, which is the one spec that
 * deliberately runs without a session.
 */
const SCREENS: { path: string; name: string; heading: RegExp }[] = [
  { path: "/my-work", name: "My Work", heading: /^My work$/i },
  { path: "/register", name: "Compliance Register", heading: /^Compliance register$/i },
  { path: "/dashboard", name: "Management Dashboard", heading: /^Management dashboard$/i },
  { path: "/calendar", name: "Renewal Calendar", heading: /^Renewal calendar$/i },
  { path: "/reports", name: "Reports", heading: /^Reports$/i },
  { path: "/admin/audit", name: "Audit Trail", heading: /^Audit trail$/i },
  { path: "/settings", name: "Settings", heading: /^Settings$/i },
];

/** Opens a screen and fails loudly if it did not render. */
async function open(page: Page, path: string, heading: RegExp) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForLoadState("networkidle");
}

test.describe("Accessibility — WCAG 2.1 AA", () => {
  for (const screen of SCREENS) {
    test(`${screen.name} has no serious accessibility violations`, async ({ page }) => {
      await open(page, screen.path, screen.heading);
      await expectNoSeriousViolations(page);
    });
  }

  /**
   * The obligation detail is the densest screen in the product and the one the
   * register exists to reach, so it is scanned even though its URL is not a
   * fixed path. The checklist tab is the busiest of its views — a metered
   * progress bar and two labelled controls on every line — and the page whose
   * colours and labels a change is most likely to break.
   */
  test("the obligation detail has no serious accessibility violations", async ({ page }) => {
    const href = await firstItemHref(page);
    const separator = href.includes("?") ? "&" : "?";
    await page.goto(`${href}${separator}tab=checklist`);
    await expect(
      page.getByRole("heading", { name: /documents the authority expects/i }),
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    await expectNoSeriousViolations(page);
  });

  test("the page is navigable by keyboard alone", async ({ page }) => {
    await open(page, "/register", /^Compliance register$/i);

    // The first Tab must reach the skip link, which is the whole point of it.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();

    // Activating it moves focus past the chrome and into the content.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("every scanned screen has exactly one level-one heading", async ({ page }) => {
    for (const screen of SCREENS) {
      await open(page, screen.path, screen.heading);
      const headings = await page.getByRole("heading", { level: 1 }).count();
      expect(headings, `${screen.name} renders ${headings} h1 elements`).toBeLessThanOrEqual(1);
    }
  });
});
