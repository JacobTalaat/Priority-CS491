import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockSignUp,
  mockSignInWithPassword,
  mockSignOut,
  mockGetSession,
  mockResend,
  mockResetPasswordForEmail,
  mockUpdateUser,
  mockOnAuthStateChange,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
  const client = {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      resend: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  };
  return {
    mockCreateClient: vi.fn(() => client),
    mockSignUp: client.auth.signUp,
    mockSignInWithPassword: client.auth.signInWithPassword,
    mockSignOut: client.auth.signOut,
    mockGetSession: client.auth.getSession,
    mockResend: client.auth.resend,
    mockResetPasswordForEmail: client.auth.resetPasswordForEmail,
    mockUpdateUser: client.auth.updateUser,
    mockOnAuthStateChange: client.auth.onAuthStateChange,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import {
  CONFIRM_EMAIL_PATH,
  MIN_PASSWORD_LENGTH,
  RESET_COULD_NOT_SEND,
  RESET_LINK_SENT,
  WRONG_CREDENTIALS,
  abandonRecovery,
  applyNewPassword,
  checkSession,
  currentToken,
  logIn,
  logOut,
  onRecovery,
  readConfirmationResult,
  resendConfirmation,
  sendPasswordResetEmail,
  signUp,
  validateLogIn,
  validateNewPassword,
  validateResetRequest,
  validateSignUp,
} from "./auth-client";

describe("validateSignUp", () => {
  it("accepts a valid email and an 8 character password", () => {
    expect(validateSignUp({ email: "student@njit.edu", password: "12345678" })).toEqual({});
  });

  it("asks for an email when it is blank and rejects a malformed one", () => {
    expect(validateSignUp({ email: "   ", password: "12345678" }).email).toBe("Enter your email.");
    expect(validateSignUp({ email: "student@", password: "12345678" }).email).toMatch(/valid email/);
  });

  it("asks for a password when it is blank", () => {
    expect(validateSignUp({ email: "student@njit.edu", password: "" }).password).toBe("Choose a password.");
  });

  it("calls a short password weak", () => {
    expect(validateSignUp({ email: "student@njit.edu", password: "1234567" }).password).toBe(
      `Password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  });
});

describe("signUp", () => {
  beforeEach(() => {
    mockSignUp.mockReset();
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates the account with Supabase Auth and returns its access token", async () => {
    mockSignUp.mockResolvedValue({
      data: {
        session: { access_token: "supabase-access-token" },
        user: { id: "auth-user-1", email: "student@njit.edu" },
      },
      error: null,
    });
    await expect(signUp({ email: " student@njit.edu ", password: "12345678" })).resolves.toEqual({
      ok: true,
      token: "supabase-access-token",
      user: { id: "auth-user-1", email: "student@njit.edu" },
    });
    expect(mockSignUp).toHaveBeenCalledWith({
      email: "student@njit.edu",
      password: "12345678",
      options: { emailRedirectTo: `http://localhost:3000${CONFIRM_EMAIL_PATH}` },
    });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("points the confirmation email at this app's confirm page", async () => {
    mockSignUp.mockResolvedValue({ data: { session: null, user: null }, error: null });
    await signUp({ email: "student@njit.edu", password: "12345678" });
    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { emailRedirectTo: "http://localhost:3000/auth/confirm" },
      }),
    );
  });

  it("switches to the check-email screen when confirmation holds the account back", async () => {
    mockSignUp.mockResolvedValue({ data: { session: null, user: null }, error: null });
    const result = await signUp({ email: " student@njit.edu ", password: "12345678" });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {},
      emailSentTo: "student@njit.edu",
    });
  });

  it("blames the email when Supabase already has an account for it", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered", status: 422 },
    });
    const result = await signUp({ email: "student@njit.edu", password: "12345678" });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { email: "That email already has an account." },
    });
  });

  it("passes Supabase's password complaint back to the password field", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null },
      error: { message: "Password should be at least 8 characters", status: 422 },
    });
    const result = await signUp({ email: "student@njit.edu", password: "a" });
    if (result.ok) {
      throw new Error("expected the weak password to be rejected");
    }
    expect(result.fieldErrors.password).toMatch(/Password is too weak/);
  });

  it("keeps other failures generic", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null },
      error: { message: "Signups not allowed", status: 403 },
    });
    const result = await signUp({ email: "student@njit.edu", password: "12345678" });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Check your email and password and try again.",
    });
  });
});

describe("validateLogIn", () => {
  it("accepts any filled in email and password", () => {
    expect(validateLogIn({ email: "student@njit.edu", password: "x" })).toEqual({});
  });

  it("asks for whatever is missing", () => {
    expect(validateLogIn({ email: " ", password: "" })).toEqual({
      email: "Enter your email.",
      password: "Enter your password.",
    });
  });
});

describe("logIn", () => {
  beforeEach(() => {
    mockSignInWithPassword.mockReset();
  });

  it("asks Supabase for a session and returns its access token", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: "supabase-access-token" },
        user: { id: "auth-user-1", email: "student@njit.edu" },
      },
      error: null,
    });
    await expect(logIn({ email: " student@njit.edu ", password: "12345678" })).resolves.toEqual({
      ok: true,
      token: "supabase-access-token",
      user: { id: "auth-user-1", email: "student@njit.edu" },
    });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "student@njit.edu",
      password: "12345678",
    });
  });

  it("shows a clear wrong password error when Supabase refuses", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials", status: 400, code: "invalid_credentials" },
    });
    expect(await logIn({ email: "student@njit.edu", password: "wrong-password" })).toEqual({
      ok: false,
      fieldErrors: {},
      formError: WRONG_CREDENTIALS,
    });
  });

  it("points an unconfirmed account back to its inbox instead of blaming the password", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Email not confirmed", status: 400, code: "email_not_confirmed" },
    });
    expect(await logIn({ email: "student@njit.edu", password: "12345678" })).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Confirm your email first. We sent a link to student@njit.edu.",
      emailSentTo: "student@njit.edu",
    });
  });

  it("treats a missing session as a failed log in", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    });
    const result = await logIn({ email: "student@njit.edu", password: "12345678" });
    expect(result).toEqual({ ok: false, fieldErrors: {}, formError: WRONG_CREDENTIALS });
  });
});

describe("validateResetRequest", () => {
  it("passes the same email rules as sign up", () => {
    expect(validateResetRequest({ email: "student@njit.edu" })).toEqual({});
    expect(validateResetRequest({ email: "   " }).email).toBe("Enter your email.");
    expect(validateResetRequest({ email: "student@" }).email).toMatch(/valid email/);
  });
});

describe("sendPasswordResetEmail", () => {
  beforeEach(() => {
    mockResetPasswordForEmail.mockReset();
    vi.stubGlobal("window", { location: { origin: "https://priority.example.edu" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the link with a redirect back to /reset-password", async () => {
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await expect(sendPasswordResetEmail(" student@njit.edu ")).resolves.toBe("sent");
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith("student@njit.edu", {
      redirectTo: "https://priority.example.edu/reset-password",
    });
  });

  it("treats a rejected address the same as a success", async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "user not found", status: 400, code: "user_not_found" },
    });
    await expect(sendPasswordResetEmail("no-account@njit.edu")).resolves.toBe("sent");
  });

  it("treats a rate limit the same as a success", async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "Rate limit exceeded", status: 429 },
    });
    await expect(sendPasswordResetEmail("student@njit.edu")).resolves.toBe("sent");
  });

  it("treats any API error that had an HTTP exchange the same as a success", async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "Email provider is not configured", status: 500, code: "email_provider_disabled" },
    });
    await expect(sendPasswordResetEmail("student@njit.edu")).resolves.toBe("sent");
    // No enumeration-visible outcome ever reports the account either way: the
    // fixed RESET_LINK_SENT message is what the form shows for all of these.
    expect(RESET_LINK_SENT).toMatch(/If an account exists/);
  });

  it("reports a fetch failure as unreachable", async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      data: {},
      error: {
        message: "Error: fetch failed",
        status: 0,
        name: "AuthRetryableFetchError",
      },
    });
    await expect(sendPasswordResetEmail("student@njit.edu")).resolves.toBe("unreachable");
  });

  it("reports a status 0 error as unreachable", async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "something odd", status: 0 },
    });
    await expect(sendPasswordResetEmail("student@njit.edu")).resolves.toBe("unreachable");
  });

  it("reports a thrown network failure as unreachable", async () => {
    mockResetPasswordForEmail.mockRejectedValue(new TypeError("network down"));
    await expect(sendPasswordResetEmail("student@njit.edu")).resolves.toBe("unreachable");
    // The connection message says nothing about accounts.
    expect(RESET_COULD_NOT_SEND).toMatch(/connection/);
  });
});

describe("validateNewPassword", () => {
  it("passes an 8 character password with a matching confirm", () => {
    expect(validateNewPassword({ password: "12345678", confirm: "12345678" })).toEqual({});
  });

  it("rules are the same ones sign up enforces", () => {
    expect(validateNewPassword({ password: "", confirm: "" })).toEqual({
      password: "Choose a password.",
      confirm: "Type the password again.",
    });
    expect(validateNewPassword({ password: "1234567", confirm: "1234567" }).password).toBe(
      `Password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`
    );
    expect(
      validateNewPassword({ password: "12345678", confirm: "123456789" }).confirm
    ).toBe("The passwords do not match.");
  });
});

describe("applyNewPassword", () => {
  beforeEach(() => {
    mockUpdateUser.mockReset();
    mockSignOut.mockReset();
    mockGetSession.mockReset();
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("updates the password, signs out the other sessions, and returns the fresh token", async () => {
    mockUpdateUser.mockResolvedValue({ data: { user: { id: "auth-user-1", email: "student@njit.edu" } } });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "fresh-token" } } });
    await expect(applyNewPassword("12345678")).resolves.toEqual({
      status: "saved",
      token: "fresh-token",
      otherSessionsEnded: true,
    });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: "12345678" });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("still reports the password as saved when reading the session afterwards fails", async () => {
    mockUpdateUser.mockResolvedValue({ data: { user: { id: "auth-user-1", email: "student@njit.edu" } } });
    mockGetSession.mockRejectedValue(new Error("storage unavailable"));
    await expect(applyNewPassword("12345678")).resolves.toEqual({
      status: "saved",
      token: null,
      otherSessionsEnded: true,
    });
  });

  it("lands Supabase's weak-password complaint on the password field", async () => {
    mockUpdateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Password should be at least 8 characters", status: 422, code: "weak_password" },
    });
    expect(await applyNewPassword("12345678")).toEqual({
      status: "failed",
      fieldErrors: { password: "Password is too weak. Password should be at least 8 characters" },
    });
  });

  it("keeps other failures generic", async () => {
    mockUpdateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Session missing", status: 400 },
    });
    expect(await applyNewPassword("12345678")).toEqual({
      status: "failed",
      fieldErrors: {},
      formError: "The new password did not save. Try again.",
    });
  });

  it("still counts the save as done when signing out the other sessions fails", async () => {
    mockUpdateUser.mockResolvedValue({ data: { user: { id: "auth-user-1", email: "student@njit.edu" } } });
    mockSignOut.mockResolvedValue({ error: { message: "service unavailable", status: 503 } });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "fresh-token" } } });
    await expect(applyNewPassword("12345678")).resolves.toEqual({
      status: "saved",
      token: "fresh-token",
      otherSessionsEnded: false,
    });
  });

  it("still counts the save as done when signing out the other sessions throws", async () => {
    mockUpdateUser.mockResolvedValue({ data: { user: { id: "auth-user-1", email: "student@njit.edu" } } });
    mockSignOut.mockRejectedValue(new TypeError("network down"));
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "fresh-token" } } });
    await expect(applyNewPassword("12345678")).resolves.toEqual({
      status: "saved",
      token: "fresh-token",
      otherSessionsEnded: false,
    });
  });

  it("returns no token when the session has gone, never a failure for a saved password", async () => {
    mockUpdateUser.mockResolvedValue({ data: { user: { id: "auth-user-1", email: "student@njit.edu" } } });
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await applyNewPassword("12345678")).toEqual({
      status: "saved",
      token: null,
      otherSessionsEnded: true,
    });
  });

  it("counts a throwing updateUser as a plain failure", async () => {
    mockUpdateUser.mockRejectedValue(new TypeError("network down"));
    expect(await applyNewPassword("12345678")).toEqual({
      status: "failed",
      fieldErrors: {},
      formError: "The new password did not save. Try again.",
    });
  });
});

describe("abandonRecovery", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
  });

  it("forgets the session locally only", async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await abandonRecovery();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does not throw even when Supabase cannot be reached", async () => {
    mockSignOut.mockRejectedValue(new TypeError("network down"));
    await expect(abandonRecovery()).resolves.toBeUndefined();
  });
});

describe("onRecovery", () => {
  beforeEach(() => {
    mockOnAuthStateChange.mockReset();
  });

  it("fires only for the PASSWORD_RECOVERY event and unsubscribes afterwards", () => {
    const recovered = vi.fn();
    const subscribers: ((event: string, session: unknown) => void)[] = [];
    const unsubscribe = vi.fn();
    mockOnAuthStateChange.mockImplementation((subscriber: (event: string, session: unknown) => void) => {
      subscribers.push(subscriber);
      return { data: { subscription: { unsubscribe } } };
    });
    const stop = onRecovery(recovered);
    subscribers[0]!("INITIAL_SESSION", { access_token: "old" });
    expect(recovered).not.toHaveBeenCalled();
    subscribers[0]!("PASSWORD_RECOVERY", { access_token: "link" });
    expect(recovered).toHaveBeenCalledTimes(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("logOut", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
  });

  it("tells Supabase, not just localStorage", async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await logOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("currentToken", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  it("returns the freshest access token the background refresh has produced", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "fresh-token" } },
    });
    await expect(currentToken()).resolves.toBe("fresh-token");
  });

  it("answers null when the browser is signed out", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(currentToken()).resolves.toBeNull();
  });
});

describe("resendConfirmation", () => {
  beforeEach(() => {
    mockResend.mockReset();
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resends with the signup type and the confirm-page redirect", async () => {
    mockResend.mockResolvedValue({ error: null });
    await expect(resendConfirmation(" student@njit.edu ")).resolves.toEqual({ ok: true });
    expect(mockResend).toHaveBeenCalledWith({
      type: "signup",
      email: "student@njit.edu",
      options: { emailRedirectTo: "http://localhost:3000/auth/confirm" },
    });
  });

  it("answers ok:false instead of throwing when Supabase refuses the send", async () => {
    mockResend.mockResolvedValue({ error: { message: "rate limited", status: 429 } });
    await expect(resendConfirmation("student@njit.edu")).resolves.toEqual({ ok: false });
  });
});

describe("readConfirmationResult", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a session saved from the fragment as a confirmed link", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "link-token" } } });
    vi.stubGlobal("window", {
      location: { hash: "#access_token=link-token&type=signup&refresh_token=r" },
    });
    await expect(readConfirmationResult()).resolves.toEqual({
      status: "confirmed",
      token: "link-token",
    });
  });

  it("answers expired for an error fragment even when an older session is stored", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "stale-token" } } });
    vi.stubGlobal("window", {
      location: {
        hash: "#error=access_denied&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired",
      },
    });
    await expect(readConfirmationResult()).resolves.toEqual({ status: "expired" });
  });

  it("calls a stray visit without a fragment invalid, session or not", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "stale-token" } } });
    vi.stubGlobal("window", { location: { hash: "" } });
    await expect(readConfirmationResult()).resolves.toEqual({ status: "invalid" });
  });

  it("falls into the expired screen instead of throwing when it cannot check", async () => {
    mockGetSession.mockRejectedValue(new Error("storage blocked"));
    vi.stubGlobal("window", { location: { hash: "#access_token=link-token" } });
    await expect(readConfirmationResult()).resolves.toEqual({ status: "expired" });
  });
});

describe("checkSession", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the user for a token our API accepts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ id: "user-1", email: "student@njit.edu" }, { status: 200 }))
    );
    expect(await checkSession("tok")).toEqual({
      status: "valid",
      user: { id: "user-1", email: "student@njit.edu" },
    });
  });

  it("reports invalid on 401 so the caller can log out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }))
    );
    expect(await checkSession("tok")).toEqual({ status: "invalid" });
  });

  it("reports offline when the API cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    expect(await checkSession("tok")).toEqual({ status: "offline" });
  });
});
