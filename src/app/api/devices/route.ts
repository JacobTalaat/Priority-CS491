import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Apple expects every device a student registers to keep receiving pushes
// (an iPhone and an iPad must both work), so rows are keyed per device, not
// one per student and platform. The cap keeps a runaway reinstall loop from
// growing the table without bound; the oldest device falls off first.
const ALLOWED_PLATFORM = "ios";
const MAX_DEVICES_PER_STUDENT = 10;
const MAX_REGISTER_ATTEMPTS = 3;

// Concurrent registrations from the same device converge through the
// (userId, deviceId) unique key, but they surface as write conflicts
// (P2034) or unique violations (P2002), which are safe to retry whole.
const RETRYABLE_TRANSACTION_ERROR_CODES = new Set(["P2034", "P2002"]);

function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    RETRYABLE_TRANSACTION_ERROR_CODES.has(String((error as { code: unknown }).code))
  );
}

// Apple does not fix a token's byte length in advance, so only the shape is
// enforced: hex, even number of characters, 32 to 400 long.
function validateDeviceToken(token: unknown): string | null {
  if (typeof token !== "string") {
    return null;
  }
  if (!/^([0-9a-f]{2})+$/i.test(token) || token.length < 32 || token.length > 400) {
    return null;
  }
  return token.toLowerCase();
}

// On iOS this is the app's identifierForVendor, stable across installs.
function validateDeviceId(deviceId: unknown): string | null {
  if (
    typeof deviceId !== "string" ||
    !/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(deviceId)
  ) {
    return null;
  }
  return deviceId.toLowerCase();
}

// Returns false when the transaction kept losing to a concurrent request;
// anything else thrown here is a real failure and propagates untouched.
async function registerDevice(userId: string, token: string, deviceId: string): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_REGISTER_ATTEMPTS; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.deviceToken.deleteMany({ where: { token } });
        await tx.deviceToken.upsert({
          where: { userId_deviceId: { userId, deviceId } },
          update: { token, platform: ALLOWED_PLATFORM },
          create: { userId, token, platform: ALLOWED_PLATFORM, deviceId },
        });
        const rows = await tx.deviceToken.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });
        if (rows.length > MAX_DEVICES_PER_STUDENT) {
          await tx.deviceToken.deleteMany({
            where: { id: { in: rows.slice(MAX_DEVICES_PER_STUDENT).map((row) => row.id) } },
          });
        }
      });
      return true;
    } catch (error) {
      if (!isRetryableTransactionError(error)) {
        throw error;
      }
    }
  }
  return false;
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { token, platform, deviceId } = body as {
    token?: unknown;
    platform?: unknown;
    deviceId?: unknown;
  };
  const normalizedToken = validateDeviceToken(token);
  if (!normalizedToken) {
    return NextResponse.json(
      { error: "Device token must be a hex string of 32 to 400 characters." },
      { status: 400 }
    );
  }
  if (platform !== ALLOWED_PLATFORM) {
    return NextResponse.json({ error: "Only the ios platform is supported." }, { status: 400 });
  }
  const normalizedDeviceId = validateDeviceId(deviceId);
  if (!normalizedDeviceId) {
    return NextResponse.json({ error: "deviceId must be a UUID." }, { status: 400 });
  }
  const registered = await registerDevice(user.id, normalizedToken, normalizedDeviceId);
  if (!registered) {
    return NextResponse.json(
      { error: "Couldn't register this device right now. Try again." },
      { status: 503 }
    );
  }
  return NextResponse.json({ registered: true });
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
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { token } = body as { token?: unknown };
  const normalizedToken = validateDeviceToken(typeof token === "string" ? token.trim() : token);
  if (!normalizedToken) {
    return NextResponse.json(
      { error: "Device token must be a hex string of 32 to 400 characters." },
      { status: 400 }
    );
  }
  const result = await prisma.deviceToken.deleteMany({
    where: { userId: user.id, token: normalizedToken },
  });
  return NextResponse.json({ removed: result.count > 0 });
}
