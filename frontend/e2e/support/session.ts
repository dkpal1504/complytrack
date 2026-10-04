/**
 * Shared session support for the end-to-end suite.
 *
 * Every test obtains its own session rather than reusing one saved at the top
 * of the run. That is not pedantry: the server rotates the refresh token on
 * every exchange, so a saved `storageState` holds a credential that the first
 * test to boot spends. Every test after it is then rejected, signed out, and
 * reports a broken product that is really a broken fixture.
 *
 * The session is still a real one — issued by the real API, to the real seeded
 * account, and presented as a refresh token exactly as a browser restart would.
 * `auth.spec.ts` separately exercises the sign-in form once per role, so this
 * shortcut can never hide a broken login.
 */

import {
  expect,
  test as base,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

export const DEMO_PASSWORD = "Comply@2026!";

export const ACCOUNTS = {
  administrator: "admin@complytrack.local",
  compliance: "compliance@complytrack.local",
  department: "safety.owner@complytrack.local",
  management: "unit.head@complytrack.local",
  auditor: "auditor@complytrack.local",
} as const;

export type Role = keyof typeof ACCOUNTS;

export const ROLES = Object.keys(ACCOUNTS) as Role[];

/** Where the app keeps its session between visits. */
const REFRESH_KEY = "complytrack.refresh";

/** Marks a tab the fixture has already seeded, so it seeds only once. */
const SEEDED_FLAG = "complytrack.e2e.seeded";

/**
 * Exchanges a seeded account's credentials for a token pair.
 *
 * Through the app's own origin, so this also exercises the dev proxy the
 * browser uses. Fails loudly rather than returning something empty: a fixture
 * that silently hands a test no session turns every assertion into a puzzle.
 */
export async function credentialsFor(request: APIRequestContext, role: Role) {
  const response = await request.post("/api/v1/auth/login", {
    data: { email: ACCOUNTS[role], password: DEMO_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(
      `Signing in as ${role} failed (${response.status()}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    mfa_required?: boolean;
  };
  // The seeded accounts carry no second factor. If that ever changes, teach
  // this to present one — do not let it surface as a mystery redirect.
  expect(body.mfa_required ?? false, `${role} now requires a second factor`).toBe(false);
  expect(body.refresh_token, `${role} was issued no refresh token`).toBeTruthy();
  return body;
}

/**
 * Seeds a browser context so the app restores this session on first paint.
 *
 * An init script rather than a `storageState`, because the token must be set
 * before the application's own scripts run — the restore path reads it during
 * the first render, and a token written afterwards is a token the app has
 * already decided it does not have.
 *
 * It writes once per tab and then leaves the value alone. Init scripts run on
 * every navigation, and the app rotates the token on every exchange, so an
 * unconditional write would hand each new page the original token again —
 * revoked by then — and sign the session out on the second navigation. Later
 * pages must inherit what the app itself stored, exactly as a real browser
 * would.
 */
export async function seedSession(context: BrowserContext, refreshToken: string) {
  await context.addInitScript(
    ([key, token, seededFlag]) => {
      try {
        if (window.sessionStorage.getItem(seededFlag)) return;
        window.localStorage.setItem(key, token);
        window.sessionStorage.setItem(seededFlag, "1");
      } catch {
        /* Storage blocked; the redirect it causes will fail the test. */
      }
    },
    [REFRESH_KEY, refreshToken, SEEDED_FLAG] as [string, string, string],
  );
}

/**
 * The suite's `test`, with a session already in place.
 *
 * `role` is a fixture option, so a describe block changes the account with
 * `test.use({ role: "auditor" })` — the same way the specs used to pick a saved
 * storage state, minus the shared credential.
 */
export const test = base.extend<{ role: Role; authenticate: void }>({
  role: ["administrator", { option: true }],

  // Automatic: a test that forgot to sign in would otherwise run against the
  // sign-in screen, and every assertion would fail for the wrong reason.
  authenticate: [
    async ({ context, request, role }, use) => {
      const { refresh_token } = await credentialsFor(request, role);
      await seedSession(context, refresh_token);
      await use();
    },
    { auto: true },
  ],
});

/** Signs in through the real form, as a person would. */
export async function signIn(page: Page, role: Role, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // The labels carry a required-field asterisk, so they are matched by prefix.
  await page.getByLabel(/^E-mail address/).fill(ACCOUNTS[role]);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Landing anywhere other than /login means the session was accepted.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

/** Signs out from the account menu in the topbar. */
export async function signOut(page: Page) {
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** True when the viewport is at the phone layout, where the sidebar is hidden. */
export function isPhone(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  return width > 0 && width < 768;
}

/**
 * The obligation links the register is actually presenting.
 *
 * The grid renders both its table and its phone card list into the DOM and
 * hides one with a media query, so counting raw `a[href^="/items/"]` anchors
 * counts every row twice. Filtering to the visible ones counts rows.
 */
export function registerRows(page: Page) {
  return page.locator('a[href^="/items/"]').filter({ visible: true });
}

/** The first register row's link target, so a spec can open a real record. */
export async function firstItemHref(page: Page): Promise<string> {
  await page.goto("/register");
  const link = registerRows(page).first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = await link.getAttribute("href");
  expect(href, "the register rendered no item links").toBeTruthy();
  return href!;
}

/**
 * The total the API reports for a register query.
 *
 * Lets a spec check what the grid claims against the server rather than
 * against a number written into the test, which would only prove the fixture
 * and the seed agree with each other.
 */
export async function apiRegisterTotal(
  request: APIRequestContext,
  role: Role,
  params: Record<string, string | number> = {},
): Promise<number> {
  const fetchTotal = async (token: string) => {
    const response = await request.get("/api/v1/items", {
      headers: { Authorization: `Bearer ${token}` },
      // One row is enough: the total describes the whole filtered set.
      params: { page_size: 1, ...params },
    });
    return response;
  };

  // One sign-in per role per run: a spec that checks a dozen filter
  // combinations would otherwise spend a dozen sessions doing it.
  let token = tokenCache.get(role);
  if (!token) {
    token = (await credentialsFor(request, role)).access_token;
    tokenCache.set(role, token);
  }

  let response = await fetchTotal(token);
  if (response.status() === 401) {
    // The access token is short-lived; if it aged out mid-run, replace it.
    tokenCache.delete(role);
    token = (await credentialsFor(request, role)).access_token;
    tokenCache.set(role, token);
    response = await fetchTotal(token);
  }

  if (!response.ok()) {
    throw new Error(`GET /items failed (${response.status()}): ${await response.text()}`);
  }
  return ((await response.json()) as { total: number }).total;
}

const tokenCache = new Map<Role, string>();

/** The total the register screen is reporting, from its own "Showing X of Y". */
export async function registerTotal(page: Page): Promise<number> {
  // The count renders in the toolbar before the rows arrive, so reading it
  // straight away would read the placeholder zero. Wait for the grid itself to
  // have settled — rows, or the empty state that stands in for them.
  await expect(
    registerRows(page)
      .first()
      .or(page.getByText("No obligations match these filters")),
  ).toBeVisible({ timeout: 20_000 });

  const summary = page.getByText(/Showing\s+[\d,]+\s+of\s+[\d,]+\s+obligations?/);
  await expect(summary).toBeVisible({ timeout: 20_000 });
  const text = (await summary.innerText()).replace(/\s+/g, " ");
  const found = /of\s+([\d,]+)/.exec(text);
  expect(found, `the register printed no total: ${text}`).not.toBeNull();
  return Number(found![1].replace(/,/g, ""));
}
