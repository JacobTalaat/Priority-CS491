// The server is the one dialing the push endpoints a browser hands us, so the
// list is closed: real push service hosts only. A student-submitted https URL
// to anything else would let the server be used to probe or attack third
// parties (SSRF).
const FIXED_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);

// Services that distribute their endpoints under subdomains, like
// web.push.apple.com. Only full labels count, so evilpush.apple.com is out.
const ROOTED_HOSTS = ["notify.windows.com", "push.apple.com"];

function isIpLiteral(hostname: string): boolean {
  // URL.hostname drops IPv6 brackets, so a colon means an IPv6 literal; the
  // dotted quad covers the IPv4 case.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

export function isAllowedPushEndpoint(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return false;
  }
  if (parsed.port !== "" && parsed.port !== "443") {
    return false;
  }
  const hostname = parsed.hostname;
  if (isIpLiteral(hostname) || hostname === "") {
    return false;
  }
  if (FIXED_HOSTS.has(hostname)) {
    return true;
  }
  return ROOTED_HOSTS.some((root) => hostname.endsWith(`.${root}`));
}
