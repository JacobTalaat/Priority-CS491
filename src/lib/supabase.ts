import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export type SupabaseIdentity = {
  authUserId: string;
  email: string;
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

function identityFromClaims(claims: { sub: string; email?: string }): SupabaseIdentity | null {
  if (claims.sub === "" || claims.email === undefined || claims.email === "") {
    return null;
  }
  return { authUserId: claims.sub, email: claims.email };
}

function identityFromUser(user: Record<string, unknown>): SupabaseIdentity | null {
  if (typeof user.id !== "string" || user.id === "" || typeof user.email !== "string" || user.email === "") {
    return null;
  }
  return { authUserId: user.id, email: user.email };
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
    return identityFromUser(user);
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
