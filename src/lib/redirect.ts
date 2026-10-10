export const DEFAULT_AFTER_LOGIN = "/today";

// Only allow paths on this site. Anything else (full URLs, "//evil.com", "/\evil.com")
// falls back to Today so a crafted log in link can't send students somewhere else.
export function safeNextPath(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  if (value === "/login" || value.startsWith("/login?") || value === "/signup" || value.startsWith("/signup?")) {
    return DEFAULT_AFTER_LOGIN;
  }
  return value;
}

export function loginPathFor(currentPath: string): string {
  return `/login?next=${encodeURIComponent(currentPath)}`;
}
