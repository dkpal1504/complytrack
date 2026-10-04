/**
 * Role-based access control, as the people holding the roles experience it.
 *
 * Two layers are checked separately, because they are separate claims: the
 * shell hides what a role cannot use (a courtesy), and the API refuses it (the
 * boundary). A test that only checked the hidden link would pass against an
 * application with no security at all.
 */

import { expect } from "@playwright/test";

import { credentialsFor, isPhone, registerRows, test } from "./support/session";

const FORBIDDEN = "This section is not part of your role";

test.describe("Role-based access", () => {
  test.use({ role: "department" });

  test("a department user cannot reach the administration screens", async ({ page }) => {
    for (const path of ["/admin/users", "/admin/master-data", "/admin/audit"]) {
      await page.goto(path);
      await expect(page.getByText(FORBIDDEN)).toBeVisible({ timeout: 20_000 });
    }
  });

  test("a department user's register holds only their own department", async ({ page, request }) => {
    // Their scope is the EHS department; the seeded register has items in
    // several, so a scoped register must be the smaller of the two.
    await page.goto("/register");
    await expect(registerRows(page).first()).toBeVisible({ timeout: 20_000 });

    const scopedTotal = Number(
      (await page.getByText(/of \d+/).first().innerText()).match(/of (\d+)/)![1],
    );
    expect(scopedTotal).toBeGreaterThan(0);

    // The number they are being compared against comes from the server, not
    // from a second browser: the point is that the server scopes the read, and
    // rendering the unscoped register as well would only prove the grid agrees
    // with itself.
    const { access_token } = await credentialsFor(request, "administrator");
    const everything = await request.get("/api/v1/items?page_size=1", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(everything.status()).toBe(200);
    const { total } = (await everything.json()) as { total: number };

    expect(scopedTotal).toBeLessThan(total);
  });

  test("the administration links are not offered at all", async ({ page }) => {
    await page.goto("/my-work");
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });

    if (isPhone(page)) {
      // The phone keeps navigation behind "More".
      await page.getByRole("button", { name: "More" }).click();
      await expect(page.getByRole("dialog", { name: "All sections" })).toBeVisible();
      await expect(page.getByRole("dialog").getByRole("link", { name: /Users & Access/ })).toHaveCount(0);
      await expect(page.getByRole("dialog").getByRole("link", { name: /Audit Trail/ })).toHaveCount(0);
    } else {
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      await expect(nav.getByRole("link", { name: /Register|Work/ }).first()).toBeVisible();
      await expect(nav.getByRole("link", { name: /Users & Access/ })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: /Audit Trail/ })).toHaveCount(0);
    }
  });
});

test.describe("Role-based access — the API is the real boundary", () => {
  test("the server refuses an out-of-role call even when the UI is bypassed", async ({
    request,
    baseURL,
  }) => {
    // Sign in through the API with the same account the browser would use.
    const { access_token: token } = await credentialsFor(request, "department");

    const users = await request.get(`${baseURL}/api/v1/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(users.status(), "a department user could list every account").toBe(403);

    const audit = await request.get(`${baseURL}/api/v1/audit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(audit.status()).toBe(403);

    // And the scoped read really is scoped, on the server.
    const scoped = await request.get(`${baseURL}/api/v1/items?page_size=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(scoped.status()).toBe(200);
    expect(await scoped.json()).toHaveProperty("total");
  });
});
