const AUTH_STORAGE_KEY = "subcon.auth";

export type AuthConfig = {
  baseUrl: string;
  token: string;
};

export function readAuthConfig(): AuthConfig | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AuthConfig>;
    if (!parsed.baseUrl) {
      return null;
    }
    return {
      baseUrl: parsed.baseUrl,
      token: typeof parsed.token === "string" ? parsed.token : "",
    };
  } catch {
    return null;
  }
}

export function writeAuthConfig(auth: AuthConfig): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuthConfig(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const withScheme = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.origin;
  } catch {
    return null;
  }
}

function buildApiUrl(input: string, baseUrl?: string): string {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input;
  }
  if (!baseUrl) {
    return input;
  }
  const trimmed = baseUrl.replace(/\/$/, "");
  const path = input.startsWith("/") ? input : `/${input}`;
  return `${trimmed}${path}`;
}

export async function fetchJson<T>(
  input: RequestInfo,
  init?: RequestInit,
  authOverride?: AuthConfig | null
): Promise<T> {
  const auth = authOverride ?? readAuthConfig();
  const url = typeof input === "string" ? buildApiUrl(input, auth?.baseUrl) : input;
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (auth?.token) {
    headers.set("Authorization", `Bearer ${auth.token}`);
  }
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers,
    credentials: "same-origin",
  });
  const text = await res.text();
  if (!res.ok) {
    let message = res.statusText;
    if (text) {
      try {
        const data = JSON.parse(text) as { error?: string };
        message = data.error ?? text;
      } catch {
        message = text;
      }
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}
