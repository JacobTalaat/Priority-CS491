import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export type SupabaseIdentity = {
  authUserId: string;
  email: string;
  // "aal1" is a password-only session, "aal2" one that has also been through
  // the second factor. Only the aal2 token may act for a student with two
  // factor on.
  aal: "aal1" | "aal2";
};

function authClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The secret key never leaves the server: only this client and only for deleting
// an auth user (account deletion must free the email for sign up again).
function adminClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function identityFromClaims(claims: { sub: string; email?: string; aal?: unknown }): SupabaseIdentity | null {
  if (claims.sub === "" || claims.email === undefined || claims.email === "") {
    return null;
  }
  return { authUserId: claims.sub, email: claims.email, aal: aalFromClaims(claims.aal) };
}

// Anything that is not exactly "aal2" counts as the first factor only; the
// claims come from Supabase, never from the client, so an unknown value is
// treated as the lower level to fail closed.
function aalFromClaims(value: unknown): "aal1" | "aal2" {
  return value === "aal2" ? "aal2" : "aal1";
}

function identityFromUser(user: Record<string, unknown>): SupabaseIdentity | null {
  if (typeof user.id !== "string" || user.id === "" || typeof user.email !== "string" || user.email === "") {
    return null;
  }
  return { authUserId: user.id, email: user.email, aal: "aal1" };
}

// Reads the assurance level straight out of the JWT payload without verifying
// it. Safe here: Supabase has just accepted this token, so its payload is
// trusted to equal what it signed; this only exists because the legacy HS256
// fallback path returns a user object with no claims to read the level from.
// A missing or unparsable payload resolves to the lower level, never the
// higher one.
function aalFromJwtPayload(token: string): "aal1" | "aal2" {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return aalFromClaims(payload?.aal);
  } catch {
    return "aal1";
  }
}

export async function verifyAccessToken(token: string): Promise<SupabaseIdentity | null> {
  try {
    const { data, error } = await authClient().auth.getClaims(token);
    if (!error && data !== null) {
      return identityFromClaims(data.claims);
    }
  } catch {
    // getClaims threw (for example the JWKS could not be fetched); the lookup
    // below is still a valid way to decide whether this token is somebody's.
  }
  // Fallback for projects still signing tokens with the legacy HS256 shared
  // secret: getClaims cannot verify those locally, and the documented path for
  // such projects is one authenticated lookup of the user with the token.
  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.supabasePublishableKey },
    });
    if (!response.ok) {
      return null;
    }
    const user = (await response.json()) as Record<string, unknown>;
    const identity = identityFromUser(user);
    if (!identity) {
      return null;
    }
    // The user lookup above proves the token is live; its aal rides in the
    // same payload it signed, so read it without another verification pass.
    return { ...identity, aal: aalFromJwtPayload(token) };
  } catch {
    return null;
  }
}

// Whether Supabase still has an auth account with this id (true), answered
// that it does not (false, a 404 or user_not_found), or the check itself
// failed (null, so the caller must fail closed). It uses the secret key on the
// server only, and callers only run it on the create-row path, so the request
// for an account that already has its row never pays for the lookup.
export async function authUserExists(authUserId: string): Promise<boolean | null> {
  try {
    const { data, error } = await adminClient().auth.admin.getUserById(authUserId);
    if (!error && data.user) {
      return true;
    }
    if (error && (error.status === 404 || error.code === "user_not_found")) {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}

// Re-authenticating with the account's password is how a destructive request
// proves it is really the student. It asks Supabase directly, so no password
// material is ever stored or checked by this app.
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const { error } = await authClient().auth.signInWithPassword({ email, password });
  return error === null;
}

export async function deleteAuthUser(authUserId: string): Promise<void> {
  const { error } = await adminClient().auth.admin.deleteUser(authUserId);
  if (error) {
    throw new Error(`Supabase refused to delete the auth user: ${error.message}`);
  }
}

// The admin MFA API answers with every factor the student enrolled, verified
// or not. Only verified TOTP factors count for the two factor gate: an
// unverified factor is a half-finished setup and must never lock a request.
export async function listVerifiedTotpFactors(authUserId: string) {
  const { data, error } = await adminClient().auth.admin.mfa.listFactors({ userId: authUserId });
  if (error) {
    throw new Error(`Supabase refused to list the MFA factors: ${error.message}`);
  }
  return data.factors.filter((factor) => factor.factor_type === "totp" && factor.status === "verified");
}

// Removes every TOTP factor the student has at Supabase, verified or not, so
// their authenticator app stops working for every future question. The Prisma
// row keeps the truth about whether two factor is actually on.
export async function deleteAllTotpFactors(authUserId: string): Promise<void> {
  const { data, error } = await adminClient().auth.admin.mfa.listFactors({ userId: authUserId });
  if (error) {
    throw new Error(`Supabase refused to list the MFA factors: ${error.message}`);
  }
  for (const factor of data.factors) {
    if (factor.factor_type !== "totp") {
      continue;
    }
    const { error: deleteError } = await adminClient().auth.admin.mfa.deleteFactor({
      userId: authUserId,
      id: factor.id,
    });
    if (deleteError) {
      throw new Error(`Supabase refused to delete the MFA factor: ${deleteError.message}`);
    }
  }
}

// Acting AS the student: their own token rides in the Authorization header,
// so the MFA endpoints answer for their account and no admin power is needed
// to recognize a code the student could have typed into the browser. Only the
// verified TOTP factor counts; "unreachable" is reported apart from a wrong
// code so a network failure does not masquerade as one.
export type StudentCodeCheck = "verified" | "rejected" | "unreachable";

export async function verifyStudentTotpCode(token: string, code: string): Promise<StudentCodeCheck> {
  const asStudent = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    const { data: factors, error: listError } = await asStudent.auth.mfa.listFactors();
    if (listError || !factors) {
      return "unreachable";
    }
    const factor = factors.all.find(
      (entry) => entry.factor_type === "totp" && entry.status === "verified"
    );
    if (!factor) {
      return "rejected";
    }
    const { error: verifyError } = await asStudent.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code,
    });
    return verifyError ? "rejected" : "verified";
  } catch {
    return "unreachable";
  }
}

// "Confirm email" being on is what stops somebody registering with an address
// that is not theirs, but nothing in this codebase can enforce that against
// Supabase — the dashboard setting is the only guarantee. Surfacing it on
// /api/health turns it into a release check. The public settings endpoint
// answers `mailer_autoconfirm`; confirmation is REQUIRED exactly when that is
// false (auto-confirm would hand out sessions for unverified addresses). The
// check can be slow and the failure mode must never be a broken health route,
// so it is cached in memory for five minutes and anything that goes wrong
// answers null instead of throwing.
const EMAIL_SETTINGS_TTL_MS = 5 * 60 * 1000;

let emailSettingsCache: { fetchedAt: number; required: boolean } | null = null;

export async function emailConfirmationRequired(now = Date.now()): Promise<boolean | null> {
  if (emailSettingsCache && now - emailSettingsCache.fetchedAt < EMAIL_SETTINGS_TTL_MS) {
    return emailSettingsCache.required;
  }
  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: env.supabasePublishableKey },
    });
    if (!response.ok) {
      return null;
    }
    const settings = (await response.json()) as { mailer_autoconfirm?: unknown };
    if (typeof settings.mailer_autoconfirm !== "boolean") {
      return null;
    }
    const required = !settings.mailer_autoconfirm;
    // Only successes are cached; a failed read retries after the next route hit.
    emailSettingsCache = { fetchedAt: now, required };
    return required;
  } catch {
    return null;
  }
}
