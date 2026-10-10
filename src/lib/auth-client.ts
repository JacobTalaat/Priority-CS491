import { apiRequest } from "./api-client";

// Must match the minimum enforced by /api/auth/signup and /api/auth/login.
export const MIN_PASSWORD_LENGTH = 8;

export type Credentials = {
  email: string;
  password: string;
};

export type FieldErrors = Partial<Record<keyof Credentials, string>>;

export type AuthUser = {
  id: string;
  email: string;
};

type AuthResponse = {
  token: string;
  user: AuthUser;
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

export async function signUp({ email, password }: Credentials): Promise<AuthResult> {
  const result = await apiRequest<AuthResponse>("/api/auth/signup", {
    method: "POST",
    body: { email: email.trim(), password },
  });
  if (result.ok) {
    return { ok: true, token: result.data.token, user: result.data.user };
  }
  if (result.status === 409) {
    return { ok: false, fieldErrors: { email: "That email already has an account." } };
  }
  if (result.status === 400) {
    return { ok: false, fieldErrors: {}, formError: "Check your email and password and try again." };
  }
  return { ok: false, fieldErrors: {}, formError: result.error };
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
  const result = await apiRequest<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: { email: email.trim(), password },
  });
  if (result.ok) {
    return { ok: true, token: result.data.token, user: result.data.user };
  }
  // The API answers 400 for a malformed email or a password under 8 characters. Neither can
  // belong to a real account, so treat it the same as a wrong password.
  if (result.status === 401 || result.status === 400) {
    return { ok: false, fieldErrors: {}, formError: WRONG_CREDENTIALS };
  }
  return { ok: false, fieldErrors: {}, formError: result.error };
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
