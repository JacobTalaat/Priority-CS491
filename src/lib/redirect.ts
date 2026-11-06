export const DEFAULT_AFTER_LOGIN = "/today";

// Browsers strip tab, newline and carriage return characters out of URLs
// before resolving them, so "/\t/evil.com" looks like a path but lands on
// http://evil.com/. Control characters and backslashes are therefore rejected
// outright, and whatever is left must resolve (against a fixed origin) to a
// same-origin URL before it is handed back.
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F\\]/;

const SITE_ORIGIN = "http://priority.invalid";

// Only allow paths on this site. Anything else (full URLs, "//evil.com",
// "/\evil.com") falls back to Today so a crafted log in link can't send
// students somewhere else.
export function safeNextPath(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  // A leading "//" is a protocol-relative URL: the browser resolves it against
  // the page's own scheme whatever host follows, so it must never pass even
  // when the host happens to spell a string we use below.
  if (!value || !value.startsWith("/") || value.startsWith("//") || FORBIDDEN_CHARS.test(value)) {
    return DEFAULT_AFTER_LOGIN;
  }
  let url: URL;
  try {
    url = new URL(value, SITE_ORIGIN);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  // Same origin means the URL parser turned it into a plain path on this site;
  // anything else is a jump off-site no matter how it was spelled.
  if (url.origin !== SITE_ORIGIN) {
    return DEFAULT_AFTER_LOGIN;
  }
  const pathname = url.pathname;
  if (pathname === "/login" || pathname === "/signup") {
    return DEFAULT_AFTER_LOGIN;
  }
  return value;
}

export function loginPathFor(currentPath: string): string {
  return `/login?next=${encodeURIComponent(currentPath)}`;
}
