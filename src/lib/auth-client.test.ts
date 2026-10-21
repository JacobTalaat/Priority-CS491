import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockSignUp, mockSignInWithPassword, mockSignOut, mockGetSession } =
  vi.hoisted(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
    const client = {
      auth: {
        signUp: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        getSession: vi.fn(),
      },
    };
    return {
      mockCreateClient: vi.fn(() => client),
      mockSignUp: client.auth.signUp,
      mockSignInWithPassword: client.auth.signInWithPassword,
      mockSignOut: client.auth.signOut,
      mockGetSession: client.auth.getSession,
    };
  });

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import {
  MIN_PASSWORD_LENGTH,
  WRONG_CREDENTIALS,
  checkSession,
  currentToken,
  logIn,
  logOut,
  signUp,
  validateLogIn,
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
    expect(mockSignUp).toHaveBeenCalledWith({ email: "student@njit.edu", password: "12345678" });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("sends the student to their email when the project requires confirmation", async () => {
    mockSignUp.mockResolvedValue({ data: { session: null, user: null }, error: null });
    const result = await signUp({ email: "student@njit.edu", password: "12345678" });
    if (result.ok) {
      throw new Error("expected the sign up to be held back for confirmation");
    }
    expect(result.formError).toMatch(/check your email/i);
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
      error: { message: "Invalid login credentials", status: 400 },
    });
    expect(await logIn({ email: "student@njit.edu", password: "wrong-password" })).toEqual({
      ok: false,
      fieldErrors: {},
      formError: WRONG_CREDENTIALS,
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

describe("logOut", () => {
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
