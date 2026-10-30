// Shared between /sw.js (via importScripts) and the vitest suite (via
// module.exports): a push payload may name any URL, but a click may only ever
// navigate to this app's origin. Returns the path + search + hash to open, or
// null when the payload url is missing or points somewhere else.
function pushUrlTarget(rawUrl, origin) {
  if (typeof rawUrl !== "string") {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(rawUrl, origin);
  } catch {
    return null;
  }
  const isHttp = parsed.protocol === "https:" || parsed.protocol === "http:";
  if (!isHttp || parsed.origin !== origin) {
    return null;
  }
  return parsed.pathname + parsed.search + parsed.hash;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { pushUrlTarget };
}
if (typeof importScripts === "function") {
  self.pushUrlTarget = pushUrlTarget;
}
