import { isIP } from "node:net";
import dnsPromises from "node:dns/promises";

export type ResolvedAddress = { address: string };

type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: DnsResolver = (hostname) => dnsPromises.lookup(hostname, { all: true });

// replaced by tests so the suite never resolves real DNS
let resolver: DnsResolver = systemResolver;

export function setDnsResolverForTests(override: DnsResolver | null): void {
  resolver = override ?? systemResolver;
}

export class PublicHostError extends Error {
  readonly kind: "private" | "network";

  constructor(kind: "private" | "network", message: string) {
    super(message);
    this.name = "PublicHostError";
    this.kind = kind;
  }
}

export function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const [a, b, c, d] = octets.map(Number);
  if (octets.some((part) => Number(part) > 255)) {
    return true;
  }
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    // Not globally routable (IANA special-purpose registry): protocol assignments,
    // benchmarking (which a deployment may route internally), and documentation.
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

function isPrivateIpv4Bytes(a: number, b: number, c: number, d: number): boolean {
  return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
}

// expands any IPv6 literal (hex or dotted-quad tail, "::" elision) to 16 bytes
function parseIpv6(input: string): Uint8Array | null {
  let s = input.toLowerCase();
  if (s.includes("%")) {
    return null;
  }
  const dottedTail = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dottedTail) {
    const [a, b, c, d] = [1, 2, 3, 4].map((i) => Number(dottedTail[i]));
    if (a > 255 || b > 255 || c > 255 || d > 255) {
      return null;
    }
    // replace the dotted quad with two hex groups; drop its separating colon
    const at = dottedTail.index ?? 0;
    s = `${s.slice(0, at - 1)}:${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  if (halves.length === 1 && head.length !== 8) {
    return null;
  }
  if (head.length + tail.length > 8) {
    return null;
  }
  const groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value = parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function isPrivateIpv6(bytes: Uint8Array): boolean {
  const allZero = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);
  if (bytes.every((b) => b === 0)) {
    return true; // :: unspecified
  }
  if (allZero(0, 15) && bytes[15] === 1) {
    return true; // ::1 loopback
  }
  if (bytes[0] === 0xfc || bytes[0] === 0xfd) {
    return true; // fc00::/7 unique local
  }
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) {
    return true; // fe80::/10 link-local
  }
  if (bytes[0] === 0xff) {
    return true; // ff00::/8 multicast
  }
  // IPv4-mapped (::ffff:a.b.c.d, hex or dotted) and IPv4-compatible (::a.b.c.d):
  // decide by the embedded IPv4 address
  const embedded = () => isPrivateIpv4Bytes(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (allZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return embedded();
  }
  if (allZero(0, 12)) {
    return embedded();
  }
  // IPv4-translated ::ffff:0:a.b.c.d (RFC 2765) carries an IPv4 address too.
  if (allZero(0, 8) && bytes[8] === 0xff && bytes[9] === 0xff && bytes[10] === 0 && bytes[11] === 0) {
    return embedded();
  }
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48 translate to the IPv4 address in the low bytes.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return embedded();
  }
  // 6to4 2002::/16 carries its IPv4 address in bytes 2 to 5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPrivateIpv4Bytes(bytes[2], bytes[3], bytes[4], bytes[5]);
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return isPrivateIpv4(ip);
  }
  if (version === 6) {
    // An IPv6 answer we cannot parse (for example one with a zone id) is refused
    // rather than trusted.
    const bytes = parseIpv6(ip);
    return bytes === null || isPrivateIpv6(bytes);
  }
  return false;
}

// string-level checks only: reserved names and literal private addresses.
// No DNS, so it is safe to call synchronously before a URL is accepted.
export function isInternalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return true;
  }
  return isPrivateAddress(host);
}

// Resolves hostnames so a public-looking name that points at a private address
// (10.x.x.x, 127.x.x.x, link-local, ...) is rejected before we connect.
// If the hostname is already a literal IP it was checked above, so skip DNS.
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isInternalHostname(host)) {
    throw new PublicHostError("private", "Canvas address is not a public host");
  }
  if (isIP(host)) {
    return;
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new PublicHostError("network", "Could not resolve the Canvas address");
  }
  if (addresses.length === 0) {
    throw new PublicHostError("network", "Could not resolve the Canvas address");
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new PublicHostError("private", "Canvas address is not a public host");
  }
}
