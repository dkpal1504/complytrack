/**
 * Sign-in, sign-out, session resumption and the route guard.
 *
 * This is the one spec that runs with no session at all, because it is the only
 * place the login form itself is exercised — and therefore the only place the
 * sign-in screen's own accessibility can be scanned.
 */

import { expect, test } from "@playwright/test";

import { expectNoSeriousViolations } from "./support/a11y";
import { ACCOUNTS, DEMO_PASSWORD, ROLES, signIn, signOut } from "./support/session";

test.describe("Authentication", () => {
  test("a valid account reaches the application", async ({ page }) => {
    await signIn(page, "administrator");
    await expect(page.getByRole("banner")).toBeVisible();
  });

  // One per seeded role: the fixture every other spec relies on would happily
  // mint a session for an account that cannot actually sign in, so the form
  // itself is walked once for each.
  for (const role of ROLES) {
    test(`the ${role} account can sign in through the form`, async ({ page }) => {
      await signIn(page, role);
      await expect(page.getByRole("banner")).toBeVisible({ timeout: 20_000 });
    });
  }

  test("a wrong password is refused with a message, not a session", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/^E-mail address/).fill(ACCOUNTS.administrator);
    await page.getByLabel(/^Password/).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText(/password|invalid|incorrect/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("an unknown account is refused", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/^E-mail address/).fill("nobody@complytrack.local");
    await page.getByLabel(/^Password/).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("a protected route redirects to sign-in and then honours the destination", async ({
    page,
  }) => {
    await page.goto("/register");
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel(/^E-mail address/).fill(ACCOUNTS.administrator);
    await page.getByLabel(/^Password/).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The deep link the person asked for, not the role's home page.
    await expect(page).toHaveURL(/\/register/, { timeout: 20_000 });
  });

  test("the session survives a browser restart and sign-out ends it", async ({ page }) => {
    await signIn(page, "compliance");

    // A reload is the closest a test gets to a restart: the access token is
    // memory-only, so the app must exchange the stored refresh token again.
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });

    await signOut(page);

    // And the stored session is genuinely gone, not just navigated away from.
    await page.goto("/register");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the sign-in screen is accessible", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 20_000 });

    await expectNoSeriousViolations(page);
  });
});
