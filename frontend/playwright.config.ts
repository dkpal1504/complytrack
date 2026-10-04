import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * The suite runs against a real backend with a real database, because the
 * things worth testing here are cross-cutting: does a renewal transition
 * actually move the dashboard numbers, does the reminder engine stay
 * idempotent, does a Department User really get a 403. A mocked API would
 * test the mock.
 *
 * Both servers are started for you (see `webServer` below) and torn down after.
 * Override the ports with `E2E_PORT` / `E2E_API_PORT`, point at servers you are
 * already running with `E2E_NO_SERVER=1`, or supply a different interpreter
 * with `E2E_PYTHON`.
 */
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
// 8010 rather than the app's own default 8000: a developer machine often has
// something else on 8000 already, and a port clash here is confusing to debug.
const API_PORT = Number(process.env.E2E_API_PORT ?? 8010);
const API_URL = process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`;

/**
 * The backend is started here rather than left to the caller, so `npm run e2e`
 * works from a clean checkout: a suite that fails with "connection refused"
 * teaches nobody anything about the product.
 *
 * Paths are resolved with `node:path`, not written with forward slashes — the
 * command goes through `cmd.exe` on Windows, which does not treat `/` as a
 * separator in the executable's own path.
 */
const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(CONFIG_DIR, "../backend");
const BACKEND_PYTHON =
  process.env.E2E_PYTHON ?? resolve(BACKEND_DIR, ".venv", "Scripts", "python.exe");

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts",
  fullyParallel: false, // The register is shared state; serial keeps it honest.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // IST for every assertion that reads a rendered timestamp.
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // The PRD requires the UI to be usable on a tablet and a phone, so the
    // responsive behaviour is part of the acceptance criteria, not a nicety.
    //
    // `browserName` is pinned because the device descriptors carry their own
    // default: the iPad entry asks for WebKit, which would run the tablet
    // project in a different engine from the other two and against a browser
    // this project does not otherwise depend on. The layout under test is
    // Chromium's; it should be measured there.
    {
      name: "tablet",
      use: { ...devices["iPad (gen 7)"], browserName: "chromium" },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
  ],

  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          // Started first: the Vite proxy needs it up, and the specs call the
          // real API rather than a mock.
          command: `${BACKEND_PYTHON} -m uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
          cwd: BACKEND_DIR,
          // Deliberately an application route and not `/health`: any number of
          // unrelated services answer a bare health probe, and reusing one of
          // those as "the backend" makes every spec fail for the wrong reason.
          // Only ComplyTrack serves its own enumerations.
          url: `${API_URL}/api/v1/meta`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          // `--host 127.0.0.1` matters: Vite otherwise binds only the IPv6
          // localhost, and the readiness probe below is an IPv4 request.
          command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
          env: { VITE_API_TARGET: API_URL },
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
      ],
});
