// Supabase's MFA enroll returns the QR code as a raw, unencoded SVG data URI
// with newlines and a trailing newline. next/image rejects that shape (control
// characters, raw markup), so it has to be rebuilt as a safe encoded URI before
// it reaches an <img>.
export function svgDataUri(raw: string): string {
  if (raw.startsWith("data:image/svg+xml")) {
    const comma = raw.indexOf(",");
    if (comma < 0) {
      return "";
    }
    const payload = raw.slice(comma + 1);
    if (raw.includes(";base64,")) {
      return raw.trim();
    }
    if (payload.trim() === "") {
      return "";
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload.trim())}`;
  }
  // Any other data URI is still an image, but anything else (http URLs,
  // arbitrary text) must never render here.
  return raw.startsWith("data:image/") ? raw.trim() : "";
}
