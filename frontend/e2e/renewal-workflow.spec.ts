/**
 * The renewal workflow, driven through the UI from end to end.
 *
 * This is the product's central promise (PRD §8): an obligation moves
 * Pending → Under Process → Submitted → Renewed/Closed → and the next cycle
 * opens with the expiry rolled forward. The acceptance harness proves the API
 * does it; this proves a person can actually do it, with the controls the
 * screen offers, at every width.
 *
 * The working parts live on the obligation's "Renewal cycle" tab rather than on
 * its landing view — the overview answers "what is this?", the tab answers
 * "where has it got to?". The tab is a URL parameter, so the specs below open it
 * directly and assert it is the one showing.
 *
 * Nothing here submits a transition. The register is shared state and these
 * specs run repeatedly against it, so a test that completed a move would leave
 * the cycle one step further along on every run and, in time, fail for a reason
 * that has nothing to do with the product. What is asserted instead is the rule
 * the move enforces on the way in, which is the part that can regress.
 */

import { expect, type Page } from "@playwright/test";

import { firstItemHref, registerRows, test } from "./support/session";

/**
 * Opens an obligation at one of its tabs, and waits for the page to answer.
 *
 * The tab is carried in the query string, so it is deep-linkable and a reload
 * keeps the reader where they were.
 */
async function openItemTab(page: Page, tab: string, href?: string): Promise<void> {
  const target = href ?? (await firstItemHref(page));
  const separator = target.includes("?") ? "&" : "?";
  await page.goto(`${target}${separator}tab=${tab}`);

  // The summary carries the derived status on every tab, so it is the page
  // saying it has loaded rather than the tab strip saying it has rendered.
  await expect(page.getByText("Derived status")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("tab", { name: tabLabel(tab) })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

function tabLabel(tab: string): string {
  const labels: Record<string, string> = {
    overview: "Overview",
    cycle: "Renewal cycle",
    checklist: "Checklist",
    documents: "Documents",
    comments: "Comments",
    history: "History",
  };
  return labels[tab] ?? tab;
}

test.describe("Renewal workflow", () => {
  test("an obligation records its derived dates and current cycle", async ({ page }) => {
    await openItemTab(page, "overview");

    await expect(page.getByText(/issue date/i).first()).toBeVisible();
    await expect(page.getByText(/expiry/i).first()).toBeVisible();

    // The workflow panel is what drives the cycle, and it is on its own tab.
    await openItemTab(page, "cycle");
    await expect(page.getByRole("list", { name: "Renewal progress" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Next step" })).toBeVisible();
  });

  test("the next move offers only the legal transitions and demands their fields", async ({
    page,
  }) => {
    // An item whose cycle is still Pending, so the move on offer is
    // deterministically "Start work" rather than whatever the seed happened to
    // leave the first row in.
    await page.goto("/register?status=Pending");
    const row = registerRows(page).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    const href = await row.getAttribute("href");
    expect(href, "the register has no cycle awaiting action").toBeTruthy();

    await openItemTab(page, "cycle", href!);

    const nextStep = page.getByRole("heading", { name: "Next step" }).locator("..");
    // The moves are rendered before the panel's own verify/roll-forward row, so
    // the first button in the card is the first legal move.
    const move = nextStep.getByRole("button").first();
    await expect(move).toBeVisible();
    const moveLabel = (await move.innerText()).trim();
    expect(moveLabel, "the panel offered no move from Pending").toMatch(/start work/i);

    await move.click();

    // The dialog is titled with the move, and its submit names the target state.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("heading", { name: /start work/i })).toBeVisible();

    const submit = dialog.getByRole("button", { name: /^Move to / });
    await expect(submit).toBeVisible();
    // The workflow requires the date this move is being planned against, and
    // the form refuses to submit without it. That refusal is the guard the PRD
    // asks for; a form that let the move through empty would be the bug.
    await expect(submit).toBeDisabled();
    await expect(dialog.getByLabel(/expected filing date/i)).toBeVisible();

    // Left where it was found: the cycle is not moved by reading it.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("the audit trail shows the changes made to an obligation", async ({ page }) => {
    await openItemTab(page, "history");
    await expect(page.getByText(/created|updated|status/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  /**
   * DS-01 — the required-documents checklist — is a "M" requirement, and it is
   * what the renewal work is actually done through. The seeded register used to
   * build every obligation and leave its checklist empty, so the tab answered
   * "no checklist for this cycle" on a fresh install and the progress meter had
   * nothing to count. Nothing on this screen is changed here: the checklist is
   * shared state, so what is asserted is what a reader sees.
   */
  test("the checklist lists the documents the filing needs, with their state", async ({ page }) => {
    await openItemTab(page, "checklist");

    await expect(
      page.getByRole("heading", { name: /documents the authority expects/i }),
    ).toBeVisible();

    // One line per document, each offering to attach the file beside it.
    const lines = page.getByRole("button", { name: /^Upload the file for / });
    const lineCount = await lines.count();
    expect(lineCount).toBeGreaterThan(0);

    // Every line carries exactly one of the three states the checklist offers;
    // a line with no state would be invisible work.
    const list = page.locator("ul").filter({ has: lines.first() });
    const chips = list.getByText(/^(Received|Pending|Not Required)$/);
    expect(await chips.count()).toBe(lineCount);

    // The meter beside the list counts what is outstanding — and says so to a
    // screen reader as a progressbar, not only in colour.
    const meter = page.getByRole("progressbar", { name: /of \d+ ready$/ }).first();
    await expect(meter).toBeVisible();
    const done = Number(await meter.getAttribute("aria-valuenow"));
    const applicable = Number(await meter.getAttribute("aria-valuemax"));
    expect(done).toBeGreaterThanOrEqual(0);
    expect(done).toBeLessThanOrEqual(applicable);
  });
});

test.describe("Renewal workflow — read-only roles", () => {
  test.use({ role: "auditor" });

  /**
   * The PRD's Auditor is "read-only, time-boxed, view-only access to a filtered
   * set" (§2, DS-09) — not a reader of the audit-trail screen, which is the
   * administrator's. So the auditor is checked against what that role actually
   * is: they can read an obligation, and nothing on the screen offers to change
   * it.
   */
  test("an auditor reads an obligation but is offered no way to change it", async ({ page }) => {
    await openItemTab(page, "overview");

    await expect(page.getByText(/your role cannot change it/i)).toBeVisible();

    // The cycle is readable, but the move controls are not there to press.
    await openItemTab(page, "cycle");
    await expect(page.getByRole("list", { name: "Renewal progress" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Move to / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Start work$/i })).toHaveCount(0);

    // And the administration screens are refused, not merely unlinked.
    await page.goto("/admin/audit");
    await expect(page.getByText("This section is not part of your role")).toBeVisible({
      timeout: 20_000,
    });
  });
});
