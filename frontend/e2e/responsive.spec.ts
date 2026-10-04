/**
 * The responsive contract.
 *
 * The PRD requires the UI to work on a phone and a tablet, which in practice
 * means three things that are easy to get wrong and easy to check: no screen
 * scrolls sideways, touch targets are big enough to hit standing up, and the
 * navigation is reachable with a thumb. These assertions run on whichever
 * project is executing, so they are checked at three viewport widths.
 */

import { expect, type Page } from "@playwright/test";

import { firstItemHref, isPhone, test } from "./support/session";

/** Screens worth walking at every width; the register is the hardest to fit. */
const SCREENS = ["/my-work", "/register", "/calendar", "/dashboard", "/reports"];

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

test.describe("Responsive layout", () => {
  for (const path of SCREENS) {
    test(`${path} fits the viewport without sideways scrolling`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
      // Let the data land — a table that is still loading cannot overflow.
      await page.waitForLoadState("networkidle");

      const overflow = await horizontalOverflow(page);
      expect(
        overflow,
        `${path} scrolls ${overflow}px sideways at ${page.viewportSize()?.width}px wide`,
      ).toBeLessThanOrEqual(1);
    });
  }

  /**
   * The obligation detail is the densest screen in the product — the summary,
   * the tab strip, and on the checklist tab two controls on every line — and it
   * is reached from the register rather than sitting in the list above, so it
   * gets its own pass at each width. The checklist is the tightest of its tabs.
   */
  test("the obligation detail fits the viewport without sideways scrolling", async ({ page }) => {
    const href = await firstItemHref(page);
    const separator = href.includes("?") ? "&" : "?";
    await page.goto(`${href}${separator}tab=checklist`);
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    const overflow = await horizontalOverflow(page);
    expect(
      overflow,
      `the obligation detail scrolls ${overflow}px sideways at ${page.viewportSize()?.width}px wide`,
    ).toBeLessThanOrEqual(1);
  });

  test("the navigation suits the width", async ({ page }) => {
    await page.goto("/my-work");
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });

    if (isPhone(page)) {
      const tabBar = page.getByRole("navigation", { name: "Primary navigation" });
      await expect(tabBar).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();

      // The bottom bar is pinned to the bottom edge, not floating mid-page.
      const box = await tabBar.boundingBox();
      const viewport = page.viewportSize()!;
      expect(box).not.toBeNull();
      expect(viewport.height - (box!.y + box!.height)).toBeLessThan(4);
    } else {
      const sidebar = page.getByRole("navigation", { name: "Main navigation" });
      await expect(sidebar).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
    }
  });

  test("touch targets on the phone are large enough to hit", async ({ page }) => {
    test.skip(!isPhone(page), "a pointer device has no 44px minimum");

    await page.goto("/my-work");
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });

    const tabBar = page.getByRole("navigation", { name: "Primary navigation" });
    const links = tabBar.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = await links.nth(index).boundingBox();
      expect(box, `tab bar entry ${index} is not laid out`).not.toBeNull();
      expect(box!.height, `tab bar entry ${index} is only ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the phone menu opens every section and closes on navigation", async ({ page }) => {
    test.skip(!isPhone(page), "the wide layouts show every section without a menu");

    await page.goto("/my-work");
    await page.getByRole("button", { name: "More" }).click();

    const drawer = page.getByRole("dialog", { name: "All sections" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Compliance Register" })).toBeVisible();

    await drawer.getByRole("link", { name: "Compliance Register" }).click();
    await expect(page).toHaveURL(/\/register/);
    await expect(drawer).toBeHidden();
  });
});
