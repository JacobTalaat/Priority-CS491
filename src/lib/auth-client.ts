import { createClient } from "@supabase/supabase-js";
import { apiRequest } from "./api-client";
import { env } from "@/lib/env";
import { clearToken } from "@/lib/session";

export const MIN_PASSWORD_LENGTH = 8;

// supabase-js keeps the session in localStorage and refreshes the access token
// in the background, so the token the browser holds stays valid while the tab
// is open. The app mirrors it into its own TOKEN_KEY for the Authorization
// header, the same way the iOS app will use it. The client is created lazily:
// importing this module must not require the env vars to exist, or the app
// could not even build without them.
let client: ReturnType<typeof createClient> | null = null;

function supabase() {
  client ??= createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export type Credentials = {
  email: string;
  password: string;
};

export type FieldErrors = Partial<Record<keyof Credentials, string>>;

export type AuthUser = {
  id: string;
  email: string;
};

// A failure either reports something to fix (fieldErrors / formError) or, when
// the only remaining step happens in the student's inbox, hands back the
// address the email went to so the form can switch to a check-your-email
// screen.
export type AuthResult =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; fieldErrors: FieldErrors; formError?: string; emailSentTo?: string };

// The page a confirmation email completes on: supabase-js brings the reply back
// to this exact URL, either as #access_token=… (success) or
// #error=…&error_code=… (rejected link), both readable from here.
export const CONFIRM_EMAIL_PATH = "/auth/confirm";

function emailRedirectTo(): string {
  return `${window.location.origin}${CONFIRM_EMAIL_PATH}`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignUp({ email, password }: Credentials): FieldErrors {
  const errors: FieldErrors = {};
  const trimmed = email.trim();
  if (!trimmed) {
    errors.email = "Enter your email.";
  } else if (!EMAIL_PATTERN.test(trimmed)) {
    errors.email = "Enter a valid email, like name@school.edu.";
  }
  if (!password) {
    errors.password = "Choose a password.";
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return errors;
}

function resultFromError(error: { message?: string; status?: number }): AuthResult {
  const message = error.message ?? "";
  if (error.status === 422 && /already registered/i.test(message)) {
    return { ok: false, fieldErrors: { email: "That email already has an account." } };
  }
  if (error.status === 422 && /password/i.test(message)) {
    return { ok: false, fieldErrors: { password: `Password is too weak. ${message}` } };
  }
  return { ok: false, fieldErrors: {}, formError: "Check your email and password and try again." };
}

export async function signUp({ email, password }: Credentials): Promise<AuthResult> {
  const { data, error } = await supabase().auth.signUp({
    email: email.trim(),
    password,
    // Ask Supabase to land the confirmation link on our page so the tab that
    // signed up is the one that picks the session up.
    options: { emailRedirectTo: emailRedirectTo() },
  });
  if (error) {
    return resultFromError(error);
  }
  if (!data.session || !data.user) {
    // Supabase holds the account back when the project asks students to confirm
    // their email: there is no session until they follow that link.
    return { ok: false, fieldErrors: {}, emailSentTo: email.trim() };
  }
  return {
    ok: true,
    token: data.session.access_token,
    user: { id: data.user.id, email: data.user.email ?? email.trim() },
  };
}

export function validateLogIn({ email, password }: Credentials): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) {
    errors.email = "Enter your email.";
  }
  if (!password) {
    errors.password = "Enter your password.";
  }
  return errors;
}

export const WRONG_CREDENTIALS = "Wrong email or password. Check them and try again.";

// Supabase marks an account that is still waiting for confirmation with this
// error code (the one stable handle, unlike message text).
const EMAIL_NOT_CONFIRMED = "email_not_confirmed";

export async function logIn({ email, password }: Credentials): Promise<AuthResult> {
  const address = email.trim();
  const { data, error } = await supabase().auth.signInWithPassword({
    email: address,
    password,
  });
  if (error) {
    if (error.code === EMAIL_NOT_CONFIRMED) {
      return {
        ok: false,
        fieldErrors: {},
        formError: `Confirm your email first. We sent a link to ${address}.`,
        emailSentTo: address,
      };
    }
    return { ok: false, fieldErrors: {}, formError: WRONG_CREDENTIALS };
  }
  if (!data.session || !data.user) {
    return { ok: false, fieldErrors: {}, formError: WRONG_CREDENTIALS };
  }
  return {
    ok: true,
    token: data.session.access_token,
    user: { id: data.user.id, email: data.user.email ?? address },
  };
}

export async function resendConfirmation(email: string): Promise<{ ok: boolean }> {
  const { error } = await supabase().auth.resend({
    type: "signup",
    email: email.trim(),
    options: { emailRedirectTo: emailRedirectTo() },
  });
  return { ok: error === null };
}

export type ConfirmationOutcome =
  | { status: "confirmed"; token: string }
  | { status: "expired" }
  | { status: "invalid" };

// While /auth/confirm was loading, the browser client already did its first
// pass. A good link left a session in storage and had its fragment cleared; a
// rejected link left #error=…&error_code=… behind (with any older session kept);
// a stray visit left nothing. Read the fragment BEFORE the client is created —
// supabase() may not be touched on this page until then — since afterwards
// storage alone proves nothing: an old session mask the rejection. Anything
// unexpected still answers instead of throwing; the page only has usable
// states to show.
export async function readConfirmationResult(): Promise<ConfirmationOutcome> {
  const fragment = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  if (params.has("error") || params.has("error_code")) {
    // Never read, store, or use a session believed to come from this link.
    return { status: "expired" };
  }
  if (!params.has("access_token") && params.get("type") !== "signup") {
    return { status: "invalid" };
  }
  try {
    const { data } = await supabase().auth.getSession();
    if (data.session?.access_token) {
      return { status: "confirmed", token: data.session.access_token };
    }
  } catch {
    // Could not even ask (storage failure, network down): the expired screen
    // is the one that still offers something to do, so fall into it.
  }
  return { status: "expired" };
}

// Supabase Auth also tracks the session on the server, so logging out has to
// reach it, not just forget the token in localStorage.
export async function logOut(): Promise<void> {
  await supabase().auth.signOut();
}

export const RESET_LINK_SENT =
  "If an account exists for that address, we sent a link to reset the password. Check your inbox.";

export const RESET_LINK_EXPIRED = "This reset link has expired or was already used.";

// Only for a request that never reached Supabase, so it says nothing about
// whether an account exists.
export const RESET_COULD_NOT_SEND = "Couldn't reach Priority. Check your connection and try again.";

// The login page shows this when it is opened with ?reset=done — a fixed flag on
// a fixed message, with nothing personal carried in the URL.
export const PASSWORD_CHANGED = "Your password was changed. Log in with your new password.";

export function validateResetRequest({ email }: { email: string }): FieldErrors {
  const errors: FieldErrors = {};
  const trimmed = email.trim();
  if (!trimmed) {
    errors.email = "Enter your email.";
  } else if (!EMAIL_PATTERN.test(trimmed)) {
    errors.email = "Enter a valid email, like name@school.edu.";
  }
  return errors;
}

// The account enumeration stop is here: every Supabase answer that proves an
// HTTP exchange happened — an unknown address, a rate limit, any API error —
// resolves the same "sent", and the caller shows one identical message. Only a
// request with no HTTP answer at all (AuthRetryableFetchError, status 0, or a
// thrown error) is worth telling apart from the silence about the account.
// Never log the address either.
export type ResetSendStatus = "sent" | "unreachable";

function isUnreachable(error: { status?: number; name?: string }): boolean {
  return error.name === "AuthRetryableFetchError" || error.status === 0;
}

export async function sendPasswordResetEmail(email: string): Promise<ResetSendStatus> {
  try {
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error === null) {
      return "sent";
    }
    return isUnreachable(error) ? "unreachable" : "sent";
  } catch {
    // Thrown means no HTTP answer at all.
    return "unreachable";
  }
}

export type NewPasswordValues = { password: string; confirm: string };

export type NewPasswordErrors = Partial<Record<"password" | "confirm", string>>;

export function validateNewPassword({ password, confirm }: NewPasswordValues): NewPasswordErrors {
  const errors: NewPasswordErrors = {};
  if (!password) {
    errors.password = "Choose a password.";
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!confirm) {
    errors.confirm = "Type the password again.";
  } else if (confirm !== password) {
    errors.confirm = "The passwords do not match.";
  }
  return errors;
}

export type AppliedPassword =
  | { status: "saved"; token: string | null; otherSessionsEnded: boolean }
  | { status: "failed"; fieldErrors: NewPasswordErrors; formError?: string };

// Swaps the account's password in Supabase for the new one. A failed sign out
// of the other sessions does NOT undo the save: the password is already
// changed, so this only reports it for the form to mention.
export async function applyNewPassword(password: string): Promise<AppliedPassword> {
  try {
    const { error } = await supabase().auth.updateUser({ password });
    if (error) {
      if (error.code === "weak_password") {
        // Supabase explains the rule it broke (usually a minimum length), so
        // pass that through onto the field like sign up does.
        return { status: "failed", fieldErrors: { password: `Password is too weak. ${error.message}` } };
      }
      return { status: "failed", fieldErrors: {}, formError: "The new password did not save. Try again." };
    }
    let otherSessionsEnded = true;
    try {
      const { error: signOutError } = await supabase().auth.signOut({ scope: "others" });
      otherSessionsEnded = !signOutError;
    } catch {
      otherSessionsEnded = false;
    }
    // signOut({ scope: "others" }) revokes the other devices' refresh tokens,
    // but any access token it had already issued stays valid until it expires
    // (about an hour). The current session is untouched, so its token below is
    // what keeps this browser signed in.
    // The password is saved from here on: a failed session read only means the student
    // logs in again with the new password, never that the save failed.
    let token: string | null = null;
    try {
      const { data: sessionData } = await supabase().auth.getSession();
      token = sessionData?.session?.access_token ?? null;
    } catch {
      token = null;
    }
    return { status: "saved", token, otherSessionsEnded };
  } catch {
    // updateUser itself threw; the password is not known to be changed.
    return { status: "failed", fieldErrors: {}, formError: "The new password did not save. Try again." };
  }
}

// A recovery session left behind — the student closed /reset-password without
// saving a new password — must not stay for the next person on a shared
// browser. signOut({ scope: "local" }) forgets the session in this browser
// only: other devices and the account itself are not touched.
export async function abandonRecovery(): Promise<void> {
  clearToken();
  try {
    await supabase().auth.signOut({ scope: "local" });
  } catch {
    // The local token copy is already gone, which is the part under our control.
  }
}

// onSessionChange reports only tokens and drops the event name, but the reset
// page needs to know specifically that a PASSWORD_RECOVERY event arrived — that
// is the proof the recovery link handed this browser a session. Fires as soon
// as such an event is seen and returns the usual unsubscribe function.
export function onRecovery(onRecovered: () => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      onRecovered();
    }
  });
  return () => data.subscription.unsubscribe();
}

// The freshest access token, or null when signed out. supabase-js keeps it
// refreshed in the background, so this is what the Authorization header should
// carry.
export async function currentToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

// Fires with a null token on sign-out, and right away with the current one, so
// subscribers learn the freshest token moment it changes. Returns the usual
// unsubscribe function.
export function onSessionChange(onToken: (token: string | null) => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((_event, session) => {
    onToken(session?.access_token ?? null);
  });
  return () => data.subscription.unsubscribe();
}

export type SessionCheck = { status: "valid"; user: AuthUser } | { status: "invalid" } | { status: "offline" };

// 401 means the token is gone or expired. A network failure doesn't prove that, so the
// caller can keep the student on the page instead of logging them out.
export async function checkSession(token: string): Promise<SessionCheck> {
  const result = await apiRequest<AuthUser>("/api/auth/me", { token });
  if (result.ok) {
    return { status: "valid", user: result.data };
  }
  if (result.status === 401) {
    return { status: "invalid" };
  }
  return { status: "offline" };
}
