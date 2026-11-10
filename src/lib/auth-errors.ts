// Turns a Supabase Auth failure into what the sign up or log in form tells the student.
// Supabase tags its API errors with a stable `code`; the status and message text are only a
// fallback for older answers that have no code. The point is to name the real problem: a
// student should never be told to check their password when the sign-in service is down.

export type AuthFlow = "signup" | "login";

export type AuthErrorMessage = { field?: "email" | "password"; message: string };

export const WRONG_CREDENTIALS = "Wrong email or password. Check them and try again.";

// Priority's own setup is wrong (missing or rejected Supabase settings), so nothing the
// student types can fix it.
export const SIGN_IN_UNAVAILABLE =
  "Sign-in isn't working right now because of a problem on our side, not with your email or password. Try again later.";

export const SERVICE_UNREACHABLE = "Couldn't reach the sign-in service. Check your internet connection and try again.";

export const SERVICE_ERROR = "The sign-in service had a problem. Try again in a few minutes.";

export const TOO_MANY_EMAILS = "Too many emails were sent recently. Wait a few minutes, then try again.";

export const TOO_MANY_ATTEMPTS = "Too many attempts in a short time. Wait a minute, then try again.";

const BY_CODE: Record<string, AuthErrorMessage> = {
  over_email_send_rate_limit: { message: TOO_MANY_EMAILS },
  over_request_rate_limit: { message: TOO_MANY_ATTEMPTS },
  user_already_exists: { field: "email", message: "That email already has an account." },
  email_exists: { field: "email", message: "That email already has an account." },
  email_address_invalid: { field: "email", message: "That email address can't be used. Check it for typos." },
  email_address_not_authorized: {
    field: "email",
    message: "Priority can't send email to that address right now. Try a different email address.",
  },
  signup_disabled: { message: "New accounts can't be created right now." },
  email_provider_disabled: { message: "Signing in with email is turned off right now." },
  user_banned: { message: "This account has been suspended." },
  captcha_failed: { message: "The security check didn't pass. Reload the page and try again." },
  invalid_credentials: { message: WRONG_CREDENTIALS },
  no_authorization: { message: SIGN_IN_UNAVAILABLE },
  bad_jwt: { message: SIGN_IN_UNAVAILABLE },
  request_timeout: { message: SERVICE_ERROR },
  hook_timeout: { message: SERVICE_ERROR },
  hook_timeout_after_retry: { message: SERVICE_ERROR },
  unexpected_failure: { message: SERVICE_ERROR },
};

type ErrorShape = { name?: unknown; status?: unknown; code?: unknown; message?: unknown };

export function describeAuthError(error: unknown, flow: AuthFlow): AuthErrorMessage {
  const shape: ErrorShape = typeof error === "object" && error !== null ? (error as ErrorShape) : {};
  const status = typeof shape.status === "number" ? shape.status : undefined;
  const code = typeof shape.code === "string" ? shape.code : undefined;
  const message = typeof shape.message === "string" ? shape.message : "";

  // No HTTP answer at all: offline, DNS, a blocked request, or Supabase's own retryable fetch error.
  if (shape.name === "AuthRetryableFetchError" || status === 0 || error instanceof TypeError) {
    return { message: SERVICE_UNREACHABLE };
  }
  // Thrown before any request: the app was started without its Supabase settings.
  if (status === undefined && /environment variable|SUPABASE/i.test(message)) {
    return { message: SIGN_IN_UNAVAILABLE };
  }
  // Supabase refused the app's own key, which no student input can cause.
  if (/invalid api key/i.test(message)) {
    return { message: SIGN_IN_UNAVAILABLE };
  }

  if (code === "weak_password") {
    return { field: "password", message: `Password is too weak. ${message}`.trim() };
  }
  if (code && BY_CODE[code]) {
    return BY_CODE[code];
  }

  // Answers without a code, from older Supabase versions.
  if (status === 422 && /already registered/i.test(message)) {
    return BY_CODE.user_already_exists;
  }
  if (status === 422 && /password/i.test(message)) {
    return { field: "password", message: `Password is too weak. ${message}`.trim() };
  }
  if (/signups not allowed/i.test(message)) {
    return BY_CODE.signup_disabled;
  }
  if (status === 429) {
    return { message: TOO_MANY_ATTEMPTS };
  }
  if (flow === "login" && status === 400 && /invalid login credentials/i.test(message)) {
    return { message: WRONG_CREDENTIALS };
  }
  if (status !== undefined && status >= 500) {
    return flow === "signup" && /confirmation email/i.test(message)
      ? { message: "We couldn't send the confirmation email. Try again in a few minutes." }
      : { message: SERVICE_ERROR };
  }
  if (status === 401 || status === 403) {
    return { message: SIGN_IN_UNAVAILABLE };
  }

  return {
    message:
      flow === "signup"
        ? "Something went wrong while creating your account. Try again."
        : "Something went wrong while logging you in. Try again.",
  };
}

// Problems on Priority's side are worth a console line for whoever runs the app; nothing
// the student typed goes into it.
export function isServiceProblem(described: AuthErrorMessage): boolean {
  return described.message === SIGN_IN_UNAVAILABLE || described.message === SERVICE_ERROR;
}
