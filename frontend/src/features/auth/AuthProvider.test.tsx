/**
 * Session restore, pinned because it is easy to get subtly wrong and expensive
 * when it is.
 *
 * React mounts effects twice in development, and a refresh token may only be
 * spent once. A provider that exchanges it on each mount therefore revokes its
 * own session: the first exchange succeeds, the second is rejected, and the
 * rejection path clears the credential the first one had just stored. The user
 * lands in a signed-in shell where every screen reports "Not authenticated",
 * and nothing in a production build shows it.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/features/auth/AuthProvider";
import { useAuth } from "@/features/auth/auth-context";
import { setAccessToken, setRefreshToken } from "@/lib/api";
import { queryClient } from "@/lib/query";

/** Shows the two things that decide whether a session was restored. */
function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <p>restoring</p>;
  return <p>{user ? user.name : "signed out"}</p>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PROFILE = {
  id: "u1",
  name: "Arun Nair",
  email: "admin@complytrack.local",
  role: "ADMIN",
  roles: ["ADMIN"],
  permissions: [],
};

function renderApp() {
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

function refreshCalls(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes("/auth/refresh"));
}

describe("AuthProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    setAccessToken(null);
    setRefreshToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("exchanges the refresh token once when StrictMode mounts the effect twice", async () => {
    setRefreshToken("stored-refresh");

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/auth/refresh")) {
        // Single use, exactly as the server treats it: presenting the same
        // token a second time is what the provider must never do.
        const seen = fetchMock.mock.calls.filter(([i]) =>
          String(i).includes("/auth/refresh"),
        ).length;
        return seen === 1
          ? jsonResponse({ access_token: "access-1", refresh_token: "rotated" })
          : jsonResponse({ detail: "This session is no longer valid." }, 401);
      }
      return jsonResponse(PROFILE);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => expect(screen.getByText("Arun Nair")).toBeInTheDocument());
    expect(refreshCalls(fetchMock)).toHaveLength(1);
  });

  it("clears the stored session when the server rejects it", async () => {
    setRefreshToken("stale-refresh");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "This session is no longer valid." }, 401)),
    );

    renderApp();

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
    // Leaving the dead token behind would make every later visit retry it.
    expect(localStorage.getItem("complytrack.refresh")).toBeNull();
  });

  it("stays signed out when there is no stored session at all", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(PROFILE));
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
