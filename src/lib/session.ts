// The website keeps the bearer token from sign up / log in in localStorage and sends it
// in the Authorization header, the same way the iOS app will.
export const TOKEN_KEY = "priority-token";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Private mode or blocked storage: behave as logged out instead of crashing.
    return null;
  }
}

export function getToken(): string | null {
  try {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    storage()?.setItem(TOKEN_KEY, token);
  } catch {
    // Ignore quota/permission errors; the user just won't stay logged in on reload.
  }
}

export function clearToken(): void {
  try {
    storage()?.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}
