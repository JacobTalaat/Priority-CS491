import { createECDH } from "node:crypto";
import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";

export const dynamic = "force-dynamic";

const MAX_SUBSCRIPTIONS = 10;
const MAX_ENDPOINT_LENGTH = 1000;
const MAX_BODY_BYTES = 4096;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const INVALID_SUBSCRIPTION =
  "Send endpoint as the https push service URL your browser gave you (at most 1000 characters), keys.p256dh as its uncompressed P-256 public key, and keys.auth as its 16-byte secret.";

const UNALLOWED_ENDPOINT =
  "Only Priority's supported push services (Google, Mozilla, Apple or Windows) can be used.";

const TAKEOVER_CONFLICT =
  "This browser subscription belongs to another account. Turn notifications off there first.";

function isBase64url(value: string): boolean {
  return value.length > 0 && BASE64URL_PATTERN.test(value);
}

// p256dh is an uncompressed P-256 point (0x04 followed by X and Y); a random
// base64url string of the right length usually is not a point, so the crypto
// check catches keys the push service would bounce after our own delivery.
function isValidP256dh(value: string): boolean {
  if (!isBase64url(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 65 || decoded[0] !== 0x04) {
    return false;
  }
  try {
    // computeSecret validates that the key material is a point ON the curve;
    // a throwaway local pair exists because ECDH refuses to work keyless.
    const local = createECDH("prime256v1");
    local.generateKeys();
    local.computeSecret(decoded);
    return true;
  } catch {
    return false;
  }
}

function isValidAuth(value: string): boolean {
  return isBase64url(value) && Buffer.from(value, "base64url").length === 16;
}

type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type ParseResult =
  | { ok: true; value: SubscriptionInput }
  | { ok: false; reason: "invalid" | "unallowed" };

function parseSubscription(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "invalid" };
  }
  const entries = body as Record<string, unknown>;
  for (const key of Object.keys(entries)) {
    if (!["endpoint", "keys"].includes(key)) {
      return { ok: false, reason: "invalid" };
    }
  }
  const { endpoint, keys } = entries as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return { ok: false, reason: "invalid" };
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid" };
  }
  if (!isAllowedPushEndpoint(endpoint)) {
    // An endpoint that parses but points at a non-push-service host is a real
    // registration attempt, so it earns the specific message.
    return { ok: false, reason: "unallowed" };
  }
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) {
    return { ok: false, reason: "invalid" };
  }
  const keyEntries = keys as Record<string, unknown>;
  for (const key of Object.keys(keyEntries)) {
    if (!["p256dh", "auth"].includes(key)) {
      return { ok: false, reason: "invalid" };
    }
  }
  const { p256dh, auth } = keyEntries as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== "string" || !isValidP256dh(p256dh) || typeof auth !== "string" || !isValidAuth(auth)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value: { endpoint, p256dh, auth } };
}

// A browser belongs to whoever is logged in at the moment a subscription is
// re-registered — but only when the browser's own keys are unchanged: those
// same keys prove it is literally the same subscription. Different keys reach a
// browser that stopped being someone else's, which the other student must
// disable first rather than losing silently.
async function saveSubscription(
  user: { id: string },
  input: SubscriptionInput,
  userAgent: string | null
): Promise<{ saved: boolean }> {
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: input.endpoint },
    select: { id: true, userId: true, p256dh: true, auth: true },
  });
  const sameBrowserKeys =
    existing !== null && existing.p256dh === input.p256dh && existing.auth === input.auth;
  if (existing !== null && existing.userId !== user.id && !sameBrowserKeys) {
    return { saved: false };
  }
  const data = {
    userId: user.id,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent,
    // A browser that re-subscribed (or re-logged-in) is alive again, whatever
    // the counters said.
    failureCount: 0,
  };
  // Upsert + prune run inside one per-user advisory-lock transaction so two
  // browsers in the account can never both make a row and then trim each
  // other's data out under their feet.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
    const saved = await tx.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: data,
      create: { userId: user.id, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, userAgent },
    });
    const rows = await tx.pushSubscription.findMany({
      where: { userId: user.id },
      orderBy: [{ lastSuccessAt: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const extra = rows.length - MAX_SUBSCRIPTIONS;
    if (extra <= 0) {
      return;
    }
    // Postgres sorts ascending NULLs first by default: subscriptions that have
    // never delivered are the first to drop, and the row saved just now is the
    // last resort.
    const stale = rows.filter((row) => row.id !== saved.id).slice(0, extra).map((row) => row.id);
    if (stale.length > 0) {
      await tx.pushSubscription.deleteMany({ where: { id: { in: stale }, userId: user.id } });
    }
  });
  return { saved: true };
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: INVALID_SUBSCRIPTION }, { status: 400 });
  }
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: INVALID_SUBSCRIPTION }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: INVALID_SUBSCRIPTION }, { status: 400 });
  }
  const parsed = parseSubscription(body);
  if (!parsed.ok) {
    const message = parsed.reason === "unallowed" ? UNALLOWED_ENDPOINT : INVALID_SUBSCRIPTION;
    return NextResponse.json({ error: message }, { status: 400 });
  }
  // The browser sends its user agent implicitly with every request; it is stored
  // so a mystery endpoint can be recognised by the device that registered it.
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
  const outcome = await saveSubscription(user, parsed.value, userAgent);
  if (!outcome.saved) {
    return NextResponse.json({ error: TAKEOVER_CONFLICT }, { status: 409 });
  }
  return NextResponse.json({ subscribed: true });
}

export async function DELETE(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send endpoint as the subscription to remove." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Send endpoint as the subscription to remove." }, { status: 400 });
  }
  const { endpoint } = body as { endpoint?: unknown };
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    return NextResponse.json({ error: "Send endpoint as the subscription to remove." }, { status: 400 });
  }
  const result = await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: user.id },
  });
  return NextResponse.json({ removed: result.count > 0 });
}
