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

export type AuthUser = { id: string; email: string };

type AuthOptions = {
  // The two factor recovery route uses this: the student there holds only the
  // password token and proves who they are with a recovery code instead.
  allowSingleFactor?: boolean;
  // Routes that act on the authenticator itself (turning two factor on or
  // off) only accept a session that has already answered the second factor.
  requireAal2?: boolean;
};

// The outcome is a discriminated union: a refused request, whether because
// the token is invalid or because two factor was not answered, carries no
// user; an accepted one always carries the Supabase id of that same user.
export type AuthOutcome =
  | { user: AuthUser; authUserId: string; mfaRequired: false }
  | { user: null; authUserId: string | null; mfaRequired: boolean };

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
  created: { id: string; email: string; twoFactorEnabled: boolean }
): Promise<{ user: AuthUser | null; twoFactorEnabled: boolean }> {
  if ((await authUserExists(identity.authUserId)) === false) {
    await prisma.user.deleteMany({
      where: { id: created.id, authUserId: identity.authUserId },
    });
    return { user: null, twoFactorEnabled: false };
  }
  return { user: { id: created.id, email: created.email }, twoFactorEnabled: created.twoFactorEnabled };
}

async function loadOrCreateUser(
  identity: { authUserId: string; email: string }
): Promise<{ user: AuthUser | null; twoFactorEnabled: boolean }> {
  const existing = await prisma.user.findUnique({
    where: { authUserId: identity.authUserId },
  });
  if (existing) {
    // The token's verified email is what routes see, even when the row's copy
    // has gone stale (the student changed their email in Supabase).
    return { user: { id: existing.id, email: identity.email }, twoFactorEnabled: existing.twoFactorEnabled };
  }
  // An access token keeps verifying until it expires, even after its own
  // account is deleted (deletion removed the Prisma row first, so this token
  // has no row to find). Creating a row for a deleted auth user would park a
  // ghost on the email and lock a fresh sign-up out with a P2002 forever, so
  // the row is only created when Supabase still knows the account. An unknown
  // answer (a Supabase outage) fails closed: a first request on a brand new
  // account is cheap to retry.
  if ((await authUserExists(identity.authUserId)) !== true) {
    return { user: null, twoFactorEnabled: false };
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
      return { user: { id: winner.id, email: identity.email }, twoFactorEnabled: winner.twoFactorEnabled };
    }
    // The conflict is on the email: another row holds it and no row belongs to
    // this Supabase account. The owner of the address is unproven — a signup
    // with someone else's address succeeds until email confirmation is on — so
    // the row stays exactly as it is: neither adopting nor erasing it. Erasing
    // would wipe the holder's data on re-sign-up if the database is ever
    // pointed at a different Supabase project, where every returning user's
    // auth id changes. Adopting could hand the row's Canvas token to the wrong
    // person. Fail closed: the request is unauthorized.
    console.error(
      "Refusing to reassign a user row to a Supabase account that does not already own it"
    );
    return { user: null, twoFactorEnabled: false };
  }
}

// The two factor gate lives here, not in each route: a password-only token
// (aal1) belonging to a student with two factor on never passes, no matter
// how correct the password was. It also answers strictly from what is here:
// no factor listing, no flag clearing — the recovery route and a correct code
// are the only ways a locked student gets back in.
export async function authenticateRequest(
  request: Request,
  options: AuthOptions = {}
): Promise<AuthOutcome> {
  const token = getBearerToken(request);
  if (!token) {
    return { user: null, authUserId: null, mfaRequired: false };
  }
  const identity = await verifyAccessToken(token);
  if (!identity) {
    return { user: null, authUserId: null, mfaRequired: false };
  }
  const { user, twoFactorEnabled } = await loadOrCreateUser(identity);
  if (!user) {
    return { user: null, authUserId: null, mfaRequired: false };
  }
  if (options.requireAal2 && identity.aal !== "aal2") {
    return { user: null, authUserId: identity.authUserId, mfaRequired: false };
  }
  if (identity.aal === "aal2" || options.allowSingleFactor || !twoFactorEnabled) {
    return { user, authUserId: identity.authUserId, mfaRequired: false };
  }
  return { user: null, authUserId: identity.authUserId, mfaRequired: true };
}

// Every protected route reads through here. The mfa-required outcome answers
// null exactly like an invalid token, so a password-only token can never see
// a route's data even when the password was right — no existing caller had to
// change for two factor.
export async function getUserFromRequest(request: Request, options: AuthOptions = {}) {
  const outcome = await authenticateRequest(request, options);
  return outcome.user;
}

// For the one client-facing path that reports why a token was refused: a
// student with two factor on and a password-only session gets this distinct
// 401, and the message tells them what the login screen asked for.
export function mfaRequiredResponse() {
  return NextResponse.json(
    { error: "Two factor code required", code: "mfa_required" },
    { status: 401 }
  );
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
