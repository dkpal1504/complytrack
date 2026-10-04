/**
 * The compliance register — the screen most of this product is used through.
 *
 * The register is where the grid's promises are kept: search and filters must
 * actually narrow the set, the count must describe the rows that came back, the
 * layout must degrade to cards on a phone rather than scrolling sideways, and
 * the export must contain what the grid is showing.
 */

import { expect } from "@playwright/test";

import {
  apiRegisterTotal,
  isPhone,
  registerRows,
  registerTotal,
  test,
} from "./support/session";

/** The register code of the first row, which is the one thing every row shows. */
async function firstCode(page: import("@playwright/test").Page): Promise<string> {
  const rows = registerRows(page);
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const text = await rows.first().innerText();
  const found = /\b[A-Z]{2,}-\d{3,}[A-Z-]*\b/.exec(text);
  expect(found, `no register code in the first row: ${text}`).not.toBeNull();
  return found![0];
}

test.describe("Compliance register", () => {
  test("lists the seeded obligations with their derived status", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByRole("heading", { name: "Compliance register" })).toBeVisible();
    await expect(registerRows(page).first()).toBeVisible({ timeout: 20_000 });

    // The count under the table is the paged total, and it must be a number.
    await expect(page.getByText(/of \d+/).first()).toBeVisible();
  });

  test("search by register code finds exactly that obligation", async ({ page }) => {
    await page.goto("/register");
    const code = await firstCode(page);

    const rows = registerRows(page);
    const before = await rows.count();

    await page.getByRole("searchbox").fill(code);
    await expect.poll(() => registerTotal(page), { timeout: 20_000 }).toBe(1);
    expect(before).toBeGreaterThan(1);

    // One row, and it is the one that was searched for. A code is matched by
    // the server and shown by the grid, so the two cannot disagree here.
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(code);
  });

  test("a derived-status filter narrows the set and the count agrees", async ({ page, request }) => {
    await page.goto("/register");
    await expect(registerRows(page).first()).toBeVisible({ timeout: 20_000 });

    // The advanced filters live behind "More filters".
    await page.getByRole("button", { name: /more filters/i }).click();
    await page.getByLabel("Derived status").selectOption({ label: "Expired" });

    await expect(page.getByText(/Status:\s*Expired/)).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get("derived_status")).toBe("Expired");

    // The grid's total is the server's total for the same filter — not a
    // number this test was taught, which would only prove the seed is stable.
    const expected = await apiRegisterTotal(request, "administrator", {
      derived_status: "Expired",
    });
    expect(expected).toBeGreaterThan(0);
    expect(await registerTotal(page)).toBe(expected);
  });

  test("clearing the filters restores the full register", async ({ page }) => {
    await page.goto("/register");
    await expect(registerRows(page).first()).toBeVisible({ timeout: 20_000 });
    const full = await registerTotal(page);

    await page.getByRole("searchbox").fill(await firstCode(page));
    await expect.poll(() => registerTotal(page), { timeout: 20_000 }).toBe(1);

    // Exact, because "Clear Search filter" on the chip bar also starts with
    // these words — substring matching would be ambiguous.
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect.poll(() => registerTotal(page), { timeout: 20_000 }).toBe(full);
  });

  test("the export downloads a workbook of the filtered rows", async ({ page, request }) => {
    await page.goto("/register");
    await expect(registerRows(page).first()).toBeVisible({ timeout: 20_000 });

    // With a filter set, exporting asks first — and the confirmation states
    // how many rows the workbook will hold. That number must be the server's.
    await page.getByRole("button", { name: /more filters/i }).click();
    await page.getByLabel("Derived status").selectOption({ label: "Expired" });
    // The dialog covers the toolbar while it is open, so dismiss it the way the
    // screen offers rather than reaching around it.
    await page.getByRole("button", { name: "Show results" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    const expected = await apiRegisterTotal(request, "administrator", {
      derived_status: "Expired",
    });
    await expect
      .poll(() => registerTotal(page), { timeout: 20_000 })
      .toBe(expected);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export register" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`${expected} obligation`);
    await page.getByRole("button", { name: "Export", exact: true }).click();

    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.xlsx$/i);
  });

  test("the register fits the viewport — a table on a wide screen, cards on a phone", async ({
    page,
  }) => {
    await page.goto("/register");
    await expect(registerRows(page).first()).toBeVisible({ timeout: 20_000 });

    const caption = "Compliance register: obligations with their owner";
    if (isPhone(page)) {
      // The phone presentation is a list of cards; the wide table is hidden.
      await expect(page.locator(`caption:text-matches("${caption}")`)).toBeHidden();
      await expect(page.locator("main ul li a[href^='/items/']").first()).toBeVisible();
    } else {
      await expect(page.locator("table caption")).toContainText(caption);
      await expect(page.locator("table thead th").first()).toBeVisible();
    }

    // The page itself must never scroll sideways, whatever the presentation.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the register scrolls horizontally").toBeLessThanOrEqual(1);
  });
});
