import { createClient } from "@supabase/supabase-js";
import { apiRequest } from "./api-client";
import { env } from "@/lib/env";

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

export type AuthResult =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; fieldErrors: FieldErrors; formError?: string };

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
  const { data, error } = await supabase().auth.signUp({ email: email.trim(), password });
  if (error) {
    return resultFromError(error);
  }
  if (!data.session || !data.user) {
    // Supabase holds the account back when the project asks students to confirm
    // their email: there is no session until they follow that link.
    return {
      ok: false,
      fieldErrors: {},
      formError: "Check your email to finish creating your account.",
    };
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

export async function logIn({ email, password }: Credentials): Promise<AuthResult> {
  const { data, error } = await supabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error || !data.session || !data.user) {
    return { ok: false, fieldErrors: {}, formError: WRONG_CREDENTIALS };
  }
  return {
    ok: true,
    token: data.session.access_token,
    user: { id: data.user.id, email: data.user.email ?? email.trim() },
  };
}

// Supabase Auth also tracks the session on the server, so logging out has to
// reach it, not just forget the token in localStorage.
export async function logOut(): Promise<void> {
  await supabase().auth.signOut();
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
