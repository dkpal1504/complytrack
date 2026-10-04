import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AuthContext, type AuthState } from "@/features/auth/auth-context";
import {
  ApiError,
  api,
  getRefreshToken,
  login as loginRequest,
  refreshSession,
  setAccessToken,
  setRefreshToken,
  setSessionExpiredHandler,
} from "@/lib/api";
import { queryClient, qk } from "@/lib/query";
import type { CurrentUser, LoginResponse, Role } from "@/types/api";

/**
 * Owns the session.
 *
 * The access token lives in memory only; the refresh token is persisted, so a
 * browser restart resumes the session but a stolen localStorage never yields a
 * usable access token. On boot we exchange the stored refresh token for a fresh
 * access token and load the profile — that is the only thing that decides
 * whether the user is signed in.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const mounted = useRef(true);

  const loadProfile = useCallback(async () => {
    const profile = await api<CurrentUser>("/auth/me");
    if (mounted.current) setUser(profile);
    return profile;
  }, []);

  /* Restore a session on first paint. */
  useEffect(() => {
    mounted.current = true;
    setSessionExpiredHandler(() => {
      setUser(null);
      setRefreshToken(null);
      setAccessToken(null);
      queryClient.clear();
    });

    (async () => {
      if (!getRefreshToken()) {
        setLoading(false);
        return;
      }
      try {
        // A stored refresh token means "probably still signed in" — confirm it
        // before rendering the shell, so no screen ever flashes for a user who
        // has in fact been signed out.
        //
        // Through `refreshSession` rather than a direct call: React runs this
        // effect twice under StrictMode, and a refresh token is single use, so
        // two exchanges would revoke each other. The loser of that race used to
        // clear the tokens the winner had just stored, leaving a signed-in
        // shell with no credential to fetch anything — every screen then
        // reported "Not authenticated".
        const restored = await refreshSession();
        if (!restored) throw new Error("The stored session is no longer valid.");
        await loadProfile();
      } catch {
        setRefreshToken(null);
        setAccessToken(null);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();

    return () => {
      mounted.current = false;
      setSessionExpiredHandler(null);
    };
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const response = await loginRequest(email, password);
        if (response.mfa_required && response.mfa_token) {
          // Park the challenge token; the password was correct but the second
          // factor has not been presented yet.
          setMfaToken(response.mfa_token);
          return { mfaRequired: true };
        }
        setAccessToken(response.access_token);
        setRefreshToken(response.refresh_token);
        await loadProfile();
        return { mfaRequired: false };
      } catch (caught) {
        const message =
          caught instanceof ApiError
            ? caught.detail
            : "Sign-in failed. Please try again.";
        setError(message);
        throw caught;
      }
    },
    [loadProfile],
  );

  const completeMfa = useCallback(
    async (code: string) => {
      if (!mfaToken) throw new ApiError(400, "Your sign-in session expired. Please start again.");
      setError(null);
      try {
        const response = await api<LoginResponse>("/auth/mfa/verify", {
          method: "POST",
          json: { mfa_token: mfaToken, code },
          noRetry: true,
        });
        setAccessToken(response.access_token);
        setRefreshToken(response.refresh_token);
        setMfaToken(null);
        await loadProfile();
      } catch (caught) {
        const message =
          caught instanceof ApiError ? caught.detail : "That code was not accepted.";
        setError(message);
        throw caught;
      }
    },
    [loadProfile, mfaToken],
  );

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // The local session is cleared regardless — a failed logout call must
      // never leave someone signed in on a shared terminal.
    }
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    setMfaToken(null);
    queryClient.clear();
  }, []);

  const value = useMemo<AuthState>(() => {
    const permissions = new Set(user?.permissions ?? []);
    const roles = new Set<Role>(user ? [user.role, ...(user.roles ?? [])] : []);
    return {
      user,
      loading,
      error,
      signIn,
      completeMfa,
      signOut,
      can: (permission: string) => permissions.has(permission),
      canAny: (...wanted: string[]) => wanted.some((p) => permissions.has(p)),
      hasRole: (...wanted: Role[]) => wanted.some((r) => roles.has(r)),
      refresh: async () => {
        await loadProfile();
        await queryClient.invalidateQueries({ queryKey: qk.me });
      },
    };
  }, [completeMfa, error, loading, loadProfile, signIn, signOut, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
