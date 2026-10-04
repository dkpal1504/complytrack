/**
 * The HTTP layer is the one place authentication, retry and error shaping are
 * decided, so its contract is pinned here: a single refresh-and-retry on 401,
 * field errors normalised for inline display, and a network failure surfaced as
 * a status-0 `ApiError` rather than an unhandled rejection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiError as ApiErrorType } from "@/lib/api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

/** A fresh module instance, so module-level token/refresh state never leaks. */
async function loadApi() {
  vi.resetModules();
  return import("@/lib/api");
}

function callsOf(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.map(([input, init]) => ({
    url: String(input),
    init: init as RequestInit | undefined,
  }));
}

describe("api()", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("refreshes once on a 401 and retries the original request", async () => {
    localStorage.setItem("complytrack.refresh", "refresh-token");

    const fetchMock = vi.fn(async (input: unknown, init?: unknown) => {
      void input;
      void init;
      const call = fetchMock.mock.calls.length;
      if (call === 1) return jsonResponse({ detail: "Token expired." }, 401);
      if (call === 2) {
        return jsonResponse({ access_token: "new-access", refresh_token: "new-refresh" });
      }
      return jsonResponse({ items: [], total: 0 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api, setAccessToken } = await loadApi();
    setAccessToken("stale-access");

    const result = await api<{ total: number }>("/items");

    expect(result).toEqual({ items: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const calls = callsOf(fetchMock);
    expect(calls[0].url).toContain("/items");
    expect(calls[1].url).toContain("/auth/refresh");
    expect(calls[2].url).toContain("/items");

    // The retry carries the freshly minted access token.
    const retriedHeaders = new Headers(calls[2].init?.headers);
    expect(retriedHeaders.get("Authorization")).toBe("Bearer new-access");
  });

  it("retries exactly once, even when the retry also fails", async () => {
    localStorage.setItem("complytrack.refresh", "refresh-token");

    const fetchMock = vi.fn(async () => {
      const call = fetchMock.mock.calls.length;
      if (call === 2) {
        return jsonResponse({ access_token: "new-access", refresh_token: "new-refresh" });
      }
      return jsonResponse({ detail: "Still not allowed." }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api, ApiError } = await loadApi();

    await expect(api("/items")).rejects.toBeInstanceOf(ApiError);
    // First attempt, the refresh, then a single retry — and no further loop.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("spends the refresh token once when several requests 401 together", async () => {
    localStorage.setItem("complytrack.refresh", "refresh-token");

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input).includes("/auth/refresh")) {
        return jsonResponse({ access_token: "new-access", refresh_token: "new-refresh" });
      }
      if (new Headers(init?.headers).get("Authorization") === "Bearer new-access") {
        return jsonResponse({ items: [], total: 0 });
      }
      return jsonResponse({ detail: "Not authenticated." }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await loadApi();

    // A refresh token is single use, so two exchanges would revoke each other
    // and one of these two requests would come back unauthorised — for a user
    // who is in fact signed in.
    const [first, second] = await Promise.all([api("/items"), api("/items")]);

    expect(first).toEqual({ items: [], total: 0 });
    expect(second).toEqual({ items: [], total: 0 });
    const refreshes = callsOf(fetchMock).filter((call) => call.url.includes("/auth/refresh"));
    expect(refreshes).toHaveLength(1);
  });

  it("maps an errors[] body to byField for inline display", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            detail: "Some fields need attention.",
            errors: [
              { field: "email", message: "Enter a valid e-mail address.", type: "value_error" },
              { field: "password", message: "This field is required.", type: "missing" },
            ],
          },
          422,
        ),
      ),
    );

    const { api, ApiError } = await loadApi();

    let caught: unknown;
    try {
      await api("/auth/login", { method: "POST", json: { email: "x" } });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const error = caught as ApiErrorType;
    expect(error.status).toBe(422);
    expect(error.detail).toBe("Some fields need attention.");
    expect(error.byField).toEqual({
      email: "Enter a valid e-mail address.",
      password: "This field is required.",
    });
    expect(error.isForbidden).toBe(false);
  });

  it("surfaces a network failure as an ApiError with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const { api, ApiError } = await loadApi();

    let caught: unknown;
    try {
      await api("/items");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const error = caught as ApiErrorType;
    expect(error.status).toBe(0);
    expect(error.detail).toMatch(/cannot reach the server/i);
  });
});
