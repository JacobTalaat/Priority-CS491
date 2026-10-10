import { afterEach, describe, expect, it, vi } from "vitest";
import { WRONG_CREDENTIALS, checkSession, logIn, signUp, validateLogIn, validateSignUp } from "./auth-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateSignUp", () => {
  it("accepts a valid email and an 8 character password", () => {
    expect(validateSignUp({ email: "student@njit.edu", password: "12345678" })).toEqual({});
  });

  it("asks for an email when it is blank", () => {
    expect(validateSignUp({ email: "   ", password: "12345678" }).email).toBe("Enter your email.");
  });

  it("rejects an email without a domain", () => {
    expect(validateSignUp({ email: "student@", password: "12345678" }).email).toMatch(/valid email/);
  });

  it("asks for a password when it is blank", () => {
    expect(validateSignUp({ email: "student@njit.edu", password: "" }).password).toBe("Choose a password.");
  });

  it("calls a short password weak", () => {
    expect(validateSignUp({ email: "student@njit.edu", password: "1234567" }).password).toBe(
      "Password is too weak. Use at least 8 characters.",
    );
  });
});

describe("signUp", () => {
  it("returns the token and user on success", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ token: "tok", user: { id: "u1", email: "student@njit.edu" } }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await signUp({ email: " student@njit.edu ", password: "12345678" });

    expect(result).toEqual({ ok: true, token: "tok", user: { id: "u1", email: "student@njit.edu" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/signup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "student@njit.edu", password: "12345678" }),
      }),
    );
  });

  it("puts a taken email error on the email field", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Email already registered" }, { status: 409 }));

    expect(await signUp({ email: "student@njit.edu", password: "12345678" })).toEqual({
      ok: false,
      fieldErrors: { email: "That email already has an account." },
    });
  });

  it("shows a form error when the server rejects the body", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Invalid body" }, { status: 400 }));

    const result = await signUp({ email: "student@njit.edu", password: "12345678" });

    expect(result).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Check your email and password and try again.",
    });
  });

  it("passes through other errors", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await signUp({ email: "student@njit.edu", password: "12345678" });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.formError).toMatch(/Can't reach Priority/);
  });
});

describe("validateLogIn", () => {
  it("accepts any filled in email and password", () => {
    expect(validateLogIn({ email: "student@njit.edu", password: "x" })).toEqual({});
  });

  it("asks for both fields when they are blank", () => {
    expect(validateLogIn({ email: " ", password: "" })).toEqual({
      email: "Enter your email.",
      password: "Enter your password.",
    });
  });
});

describe("logIn", () => {
  it("returns the token and user on success", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ token: "tok", user: { id: "u1", email: "student@njit.edu" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await logIn({ email: "student@njit.edu ", password: "12345678" });

    expect(result).toEqual({ ok: true, token: "tok", user: { id: "u1", email: "student@njit.edu" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "student@njit.edu", password: "12345678" }),
      }),
    );
  });

  it("shows a clear wrong password error on 401", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Invalid email or password" }, { status: 401 }));

    expect(await logIn({ email: "student@njit.edu", password: "wrong-password" })).toEqual({
      ok: false,
      fieldErrors: {},
      formError: WRONG_CREDENTIALS,
    });
  });

  it("treats a 400 (password too short to be real) as a wrong password", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Invalid body" }, { status: 400 }));

    const result = await logIn({ email: "student@njit.edu", password: "short" });

    expect(!result.ok && result.formError).toBe(WRONG_CREDENTIALS);
  });

  it("passes through server errors", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Database unavailable" }, { status: 503 }));

    const result = await logIn({ email: "student@njit.edu", password: "12345678" });

    expect(!result.ok && result.formError).toBe("Database unavailable");
  });
});

describe("checkSession", () => {
  it("returns the user for a valid token", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "u1", email: "student@njit.edu" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await checkSession("tok")).toEqual({
      status: "valid",
      user: { id: "u1", email: "student@njit.edu" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
    );
  });

  it("reports an expired or unknown token as invalid", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Unauthorized" }, { status: 401 }));
    expect(await checkSession("tok")).toEqual({ status: "invalid" });
  });

  it("does not treat a network failure as logged out", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await checkSession("tok")).toEqual({ status: "offline" });
  });

  it("does not treat a server error as logged out", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ status: "error" }, { status: 503 }));
    expect(await checkSession("tok")).toEqual({ status: "offline" });
  });
});
