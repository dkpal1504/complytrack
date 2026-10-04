/**
 * The single HTTP entry point for the whole application.
 *
 * Every request goes through here so that authentication, token refresh,
 * error shaping and download handling behave identically on all 15 screens.
 * Nothing else in the app calls `fetch` directly.
 */

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

/** Where the refresh token lives. The access token is memory-only, so a
 *  closed tab leaves nothing exploitable behind on a shared yard terminal. */
const REFRESH_KEY = "complytrack.refresh";

export interface FieldError {
  field: string;
  message: string;
  type?: string;
}

/** A failed request, normalised so callers can show a useful message. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly fieldErrors: FieldError[];

  constructor(status: number, detail: string, fieldErrors: FieldError[] = []) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.fieldErrors = fieldErrors;
  }

  /** True when the caller simply lacks the permission — shown differently
   *  from a genuine failure, because it is not an error the user can fix. */
  get isForbidden() {
    return this.status === 403;
  }

  get isNotFound() {
    return this.status === 404;
  }

  /** Field errors from the API keyed by form field, ready for inline display. */
  get byField(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const err of this.fieldErrors) out[err.field] = err.message;
    return out;
  }
}

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;
/** In-flight refresh, so ten parallel 401s trigger one refresh, not ten. */
let refreshInFlight: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null; // Private browsing, or storage disabled by policy.
  }
}

export function setRefreshToken(token: string | null) {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* Storage unavailable — the user simply logs in again next visit. */
  }
}

/** Registered by the auth provider so a dead session redirects to sign-in. */
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

async function readError(response: Response): Promise<ApiError> {
  let detail = `Request failed (${response.status}).`;
  let fieldErrors: FieldError[] = [];
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") detail = body.detail;
    if (Array.isArray(body?.errors)) fieldErrors = body.errors;
    else if (Array.isArray(body?.detail)) {
      // A raw FastAPI validation body, in case it reaches us unflattened.
      fieldErrors = body.detail.map((d: { loc?: unknown[]; msg?: string }) => ({
        field: String(d.loc?.slice(1).join(".") ?? "form"),
        message: d.msg ?? "Invalid value.",
      }));
      detail = "Some fields need attention.";
    }
  } catch {
    /* Non-JSON body (a proxy error page, say) — keep the generic message. */
  }
  return new ApiError(response.status, detail, fieldErrors);
}

/** The lock name under which refreshes are serialised across tabs. */
const REFRESH_LOCK = "complytrack.refresh";

/**
 * Runs `task` with a cross-tab lock held, when the browser has Web Locks.
 *
 * Tabs share one localStorage, so two tabs waking at the same moment would both
 * read the same refresh token and both present it. A refresh token is single
 * use, so the loser is signed out. Making the exchange wait its turn is what
 * lets it read the token the other tab has just stored instead.
 */
function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return task();
  return locks.request(REFRESH_LOCK, task) as Promise<T>;
}

/**
 * Exchanges the stored refresh token for a new access token. Shared by the boot
 * path and the 401 retry, and never runs twice at once.
 *
 * The caller must not need to know which of several simultaneous callers
 * triggered it — that is the point. Two refreshes presenting the same
 * single-use token would revoke each other, and the one that failed would
 * report a dead session for a user who is in fact signed in.
 */
export async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = withRefreshLock(async () => {
    try {
      // Read inside the lock: a tab that was waiting may have rotated the token
      // already, and the stored value is the one that is still valid.
      const refresh = getRefreshToken();
      if (!refresh) return false;
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
      };
      accessToken = data.access_token;
      if (data.refresh_token) setRefreshToken(data.refresh_token);
      return true;
    } catch {
      return false;
    }
  }).finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Serialised as JSON. Mutually exclusive with `body`. */
  json?: unknown;
  /** A pre-built body (FormData, Blob) sent as-is. */
  body?: BodyInit;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry (used by the refresh call itself). */
  noRetry?: boolean;
}

function buildUrl(path: string, query?: Record<string, unknown>) {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = "GET", json, body, query, signal, noRetry } = options;

  const headers = new Headers({ Accept: "application/json" });
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let payload = body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    payload = JSON.stringify(json);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: payload,
      signal,
      credentials: "same-origin",
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    // Distinguish "the network is down" from "the server said no": a shipyard
    // terminal losing Wi-Fi should say so plainly.
    throw new ApiError(0, "Cannot reach the server. Check your network connection.");
  }

  if (response.status === 401 && !noRetry && getRefreshToken()) {
    if (await refreshSession()) {
      return request(path, { ...options, noRetry: true });
    }
    accessToken = null;
    setRefreshToken(null);
    onSessionExpired?.();
  }

  return response;
}

/** A request that returns parsed JSON, throwing `ApiError` on any failure. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options);
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A request that returns a file, for the report and register exports. */
export async function apiFile(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; filename: string }> {
  const response = await request(path, options);
  if (!response.ok) throw await readError(response);

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const blob = await response.blob();
  return {
    blob,
    filename: match ? decodeURIComponent(match[1].trim()) : "complytrack-export",
  };
}

/** Saves a blob to disk without ever leaving the page. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Uploads a file with progress, for the document register and bulk import. */
export function uploadFile(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", buildUrl(path));
    if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        const body = xhr.response as { detail?: string; errors?: FieldError[] } | null;
        reject(
          new ApiError(
            xhr.status,
            body?.detail ?? `Upload failed (${xhr.status}).`,
            body?.errors ?? [],
          ),
        );
      }
    });
    xhr.addEventListener("error", () =>
      reject(new ApiError(0, "Upload failed. Check your network connection.")),
    );
    xhr.addEventListener("abort", () => reject(new ApiError(0, "Upload cancelled.")));
    if (signal) signal.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

/** Trigger the sign-in flow. Kept here so the base URL has one owner. */
export async function login(email: string, password: string) {
  return api<import("@/types/api").LoginResponse>("/auth/login", {
    method: "POST",
    json: { email, password },
    noRetry: true,
  });
}
