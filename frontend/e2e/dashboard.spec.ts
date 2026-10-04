/**
 * The management dashboard, and its agreement with the register.
 *
 * The dashboard is the number a manager quotes in a meeting; the register is
 * the list they are quoting it about. If the two disagree, one of them is
 * lying — which is exactly what AC-5 forbids: "Management dashboard counts
 * match the register list exactly for every filter combination; each card
 * drills to the underlying list."
 *
 * So the cross-screen check below does not compare two numbers reached by two
 * different routes. It clicks the card and reads the list the product itself
 * opened. A card whose number cannot be reproduced by its own drill-down fails
 * here, whatever the server believes.
 */

import { expect, type Page } from "@playwright/test";

import { apiRegisterTotal, registerTotal, test } from "./support/session";

/** A KPI card that drills somewhere, with the figure it is showing. */
interface DrillTile {
  /** The card's visible label, e.g. "Expired". */
  name: string;
  /** The card's accessible name, which is what a click is matched by. */
  label: string;
  value: number;
  href: string;
}

/**
 * Every KPI card that is a link, in the order the dashboard lays them out.
 *
 * Read from the rendered `aria-label`, which the tile builds from its own label
 * and value — so a card that is renamed, or whose value moves, is picked up
 * here without this spec being taught about it.
 */
async function drillTiles(page: Page): Promise<DrillTile[]> {
  const cards = page.locator("section[aria-label='Key figures']").getByRole("link");
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });

  const tiles: DrillTile[] = [];
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    const label = (await card.getAttribute("aria-label")) ?? "";
    const href = (await card.getAttribute("href")) ?? "";
    // The value is the only tabular figure on the tile; the hint is not.
    const text = await card.locator("p.tabular").first().innerText();
    const found = /-?[\d,]+(?:\.\d+)?/.exec(text);
    expect(found, `no number on the "${label}" card: ${text}`).not.toBeNull();
    tiles.push({
      name: label.split(":")[0].trim(),
      label,
      value: Number(found![0].replace(/,/g, "")),
      href,
    });
  }
  return tiles;
}

/** Reads a KPI card's rendered value by its label. */
async function kpi(page: Page, label: string): Promise<number> {
  const card = page
    .locator("section[aria-label='Key figures'] > div > *")
    .filter({ hasText: label })
    .first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  const text = await card.locator("p.tabular").first().innerText();
  const found = /-?[\d,]+(?:\.\d+)?/.exec(text);
  expect(found, `no number in the "${label}" tile: ${text}`).not.toBeNull();
  return Number(found![0].replace(/,/g, ""));
}

/**
 * The real units in the dashboard's unit filter.
 *
 * The toolbar appears when the dashboard answers, and its options when the
 * lookups do — two separate requests, so reading the list straight after a
 * navigation can find a rendered select with nothing in it yet.
 */
async function unitOptions(page: Page): Promise<{ value: string; label: string }[]> {
  const select = page.getByLabel("Unit");
  await expect(select).toBeVisible({ timeout: 20_000 });

  let options: { value: string; label: string }[] = [];
  await expect
    .poll(
      async () => {
        options = await select.locator("option").evaluateAll((nodes) =>
          nodes
            .map((node) => ({
              value: (node as HTMLOptionElement).value,
              label: (node.textContent ?? "").trim(),
            }))
            .filter((option) => option.value),
        );
        return options.length;
      },
      { timeout: 20_000, message: "the unit filter never filled with units" },
    )
    .toBeGreaterThan(0);
  return options;
}

/** The total the register reports for whatever it is currently showing. */

test.describe("Management dashboard", () => {
  test("renders the key figures and the status split", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Management dashboard" })).toBeVisible();
    const figures = page.locator("section[aria-label='Key figures']");
    await expect(figures.getByText("Total active obligations")).toBeVisible({ timeout: 20_000 });
    await expect(figures.getByText("Compliance Index")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Status split" })).toBeVisible();
  });

  test("every KPI card drills into a register list of exactly its own size", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const tiles = await drillTiles(page);
    expect(tiles.length, "no KPI card drills anywhere").toBeGreaterThan(3);

    for (const tile of tiles) {
      // The index is a weighted percentage, not a count of rows, so the list
      // behind it cannot be as long as the figure. It still has to go
      // somewhere sensible — the whole counted population.
      const isRatio = /index/i.test(tile.label);

      await test.step(tile.label, async () => {
        // Clicked, not navigated to: this is the assertion that the card is
        // actually a way into the list, which is what AC-5 asks for.
        await page.goto("/dashboard");
        await page.getByRole("link", { name: tile.label, exact: true }).click();
        await expect(page.getByRole("heading", { name: "Compliance register" })).toBeVisible({
          timeout: 20_000,
        });

        const total = await registerTotal(page);
        if (!isRatio) {
          expect(
            total,
            `the "${tile.label}" card says ${tile.value}, its own drill-down shows ${total}`,
          ).toBe(tile.value);
        }
        expect(new URL(page.url()).searchParams.get("bucket")).toBe(
          new URL(tile.href, "http://localhost").searchParams.get("bucket"),
        );
      });
    }
  });

  test("a drilled register says which dashboard group it is showing", async ({ page }) => {
    await page.goto("/dashboard");
    const expired = (await drillTiles(page)).find((tile) => /expired/i.test(tile.label));
    expect(expired, "the Expired card no longer drills anywhere").toBeTruthy();

    await page.goto(expired!.href);
    // Exact, with the colon: the "More filters" dialog has a field of the same
    // name, and this is the chip, not the control.
    const label = page.getByText("Dashboard group:", { exact: true });
    await expect(label).toBeVisible({ timeout: 20_000 });
    await expect(label.locator("xpath=..")).toContainText("Expired");

    // Clearing it is what a user does when they have finished reading the
    // slice, so it has to work from the chip rather than only by editing the URL.
    await page.getByRole("button", { name: "Clear Dashboard group filter" }).click();
    await expect(page).not.toHaveURL(/bucket=/);
    await expect
      .poll(() => registerTotal(page), { timeout: 20_000 })
      .toBeGreaterThan(expired!.value);
  });

  test("the drill-down keeps the filters the dashboard was read under", async ({
    page,
    request,
  }) => {
    // A card and a unit for which the scoped number is genuinely different from
    // the whole-estate one. Found from the data rather than assumed, because
    // which pair that is is a fact about the seed, not about the product.
    await page.goto("/dashboard");
    const options = await unitOptions(page);

    let found: { tile: DrillTile; unit: { value: string }; total: number } | null = null;
    for (const tile of await drillTiles(page)) {
      if (/index/i.test(tile.name)) continue; // A ratio, not a count of rows.
      const drill = new URL(tile.href, "http://localhost").searchParams.get("bucket")!;
      const whole = await apiRegisterTotal(request, "administrator", { bucket: drill });
      expect(whole).toBe(tile.value);
      for (const unit of options) {
        const total = await apiRegisterTotal(request, "administrator", {
          bucket: drill,
          unit_id: unit.value,
        });
        if (total > 0 && total < whole) {
          found = { tile, unit, total };
          break;
        }
      }
      if (found) break;
    }
    test.skip(
      !found,
      "no single unit holds part of what any card counts, so there is nothing to distinguish",
    );

    await page.goto("/dashboard");
    await page.getByLabel("Unit").selectOption(found!.unit.value);
    await expect
      .poll(() => kpi(page, found!.tile.name), { timeout: 20_000 })
      .toBe(found!.total);

    // The card was read under a unit filter, so its list has to be too —
    // otherwise the manager clicks through to a number several times larger.
    // Matched by the card's name, not its accessible name: that one embeds the
    // figure, which has just changed along with the filter.
    const card = (await drillTiles(page)).find((tile) => tile.name === found!.tile.name)!;
    expect(new URL(card.href, "http://localhost").searchParams.get("unit_id")).toBe(
      found!.unit.value,
    );

    await page.goto(card.href);
    expect(await registerTotal(page)).toBe(found!.total);
  });

  test("filtering the dashboard by unit changes the figures", async ({ page }) => {
    await page.goto("/dashboard");
    const all = await kpi(page, "Total active obligations");

    const [unit] = await unitOptions(page);
    test.skip(!unit, "the seeded data has no units to filter by");

    await page.getByLabel("Unit").selectOption(unit.value);
    await expect
      .poll(() => kpi(page, "Total active obligations"), { timeout: 20_000 })
      .toBeLessThan(all);
  });
});
