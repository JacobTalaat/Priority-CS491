import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authUserExists, verifyAccessToken } from "@/lib/supabase";

function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

// Account deletion removes the Prisma row before the Supabase auth user, so a
// concurrent request holding a stale token can pass every check above right
// before the auth user goes and create its row in the gap between the two
// deletes. One that authenticates forever. Re-checking the account right
// after creating closes that window: only a definite "gone" (false) throws
// the fresh row away, an unreachable Supabase (null) or a still-live account
// (true) keeps it, since failing closed here would lock the student out over
// an outage.
async function finishCreate(
  identity: { authUserId: string; email: string },
  created: { id: string; email: string }
): Promise<{ id: string; email: string } | null> {
  if ((await authUserExists(identity.authUserId)) === false) {
    await prisma.user.deleteMany({
      where: { id: created.id, authUserId: identity.authUserId },
    });
    return null;
  }
  return { id: created.id, email: created.email };
}

export async function getUserFromRequest(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }
  const identity = await verifyAccessToken(token);
  if (!identity) {
    return null;
  }
  const existing = await prisma.user.findUnique({
    where: { authUserId: identity.authUserId },
  });
  if (existing) {
    // The token's verified email is what routes see, even when the row's copy
    // has gone stale (the student changed their email in Supabase).
    return { id: existing.id, email: identity.email };
  }
  // An access token keeps verifying until it expires, even after its own
  // account is deleted (deletion removed the Prisma row first, so this token
  // has no row to find). Creating a row for a deleted auth user would park a
  // ghost on the email and lock a fresh sign-up out with a P2002 forever, so
  // the row is only created when Supabase still knows the account. An unknown
  // answer (a Supabase outage) fails closed: a first request on a brand new
  // account is cheap to retry.
  if ((await authUserExists(identity.authUserId)) !== true) {
    return null;
  }
  try {
    const created = await prisma.user.create({
      data: { authUserId: identity.authUserId, email: identity.email },
    });
    return await finishCreate(identity, created);
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    // Two first logins raced with the same Supabase id: whichever create won,
    // its row is the one to hand back.
    const winner = await prisma.user.findUnique({
      where: { authUserId: identity.authUserId },
    });
    if (winner) {
      return { id: winner.id, email: identity.email };
    }
    // The conflict is on the email: another row holds it and no row belongs to
    // this Supabase account. If that row's own auth account is gone it is an
    // orphan of a deleted account — erased data that came back through a
    // still-valid token — and it can be removed to free the email. It is
    // erased, never adopted: the new sign-up's ownership of the address is
    // unproven until email confirmation is on, and adopting could hand the
    // orphan's Canvas token to the wrong person. The scoped delete only fires
    // if the row still belongs to the same auth user.
    const holder = await prisma.user.findUnique({
      where: { email: identity.email },
    });
    if (!holder) {
      // No row owns the email after all, yet the create failed; nothing is
      // known, so fail closed as before.
      console.error(
        "Refusing to reassign a user row to a Supabase account that does not already own it"
      );
      return null;
    }
    if ((await authUserExists(holder.authUserId)) !== false) {
      // The holder's auth account still exists (or the check is unknown), so
      // nobody has proven this row is abandoned: a signup with someone else's
      // address succeeds until email confirmation is on. Fail closed, and the
      // row stays exactly as it is.
      console.error(
        "Refusing to reassign a user row to a Supabase account that does not already own it"
      );
      return null;
    }
    console.error("Deleting an orphaned user row left behind by a deleted auth account");
    await prisma.user.deleteMany({
      where: { id: holder.id, authUserId: holder.authUserId },
    });
    try {
      const created = await prisma.user.create({
        data: { authUserId: identity.authUserId, email: identity.email },
      });
      return await finishCreate(identity, created);
    } catch (retryError) {
      if (!isUniqueConstraintError(retryError)) {
        throw retryError;
      }
      // A concurrent request created the row with this auth account while the
      // orphan was being removed: its row is the one to hand back.
      const race = await prisma.user.findUnique({
        where: { authUserId: identity.authUserId },
      });
      if (race) {
        return { id: race.id, email: identity.email };
      }
      return null;
    }
  }
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
