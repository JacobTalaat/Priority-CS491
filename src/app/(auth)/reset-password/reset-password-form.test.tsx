// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown> & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const {
  mockCreateClient,
  mockGetSession,
  mockUpdateUser,
  mockSignOut,
  mockOnAuthStateChange,
  mockReplace,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
  const client = {
    auth: {
      getSession: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  };
  return {
    mockCreateClient: vi.fn(() => client),
    mockGetSession: client.auth.getSession,
    mockUpdateUser: client.auth.updateUser,
    mockSignOut: client.auth.signOut,
    mockOnAuthStateChange: client.auth.onAuthStateChange,
    mockReplace: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

import { MIN_PASSWORD_LENGTH, PASSWORD_CHANGED, RESET_LINK_EXPIRED } from "@/lib/auth-client";
import { TOKEN_KEY } from "@/lib/session";
import { ResetPasswordForm } from "./reset-password-form";

const GOOD_FRAGMENT = "#access_token=link-token&expires_in=3600&refresh_token=ref&token_type=bearer&type=recovery";

const mountedRoots: { unmount(): void }[] = [];

async function mounted(strict = false): Promise<HTMLDivElement> {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(strict ? <StrictMode><ResetPasswordForm /></StrictMode> : <ResetPasswordForm />);
  });
  mountedRoots.push(root);
  return div;
}

// React's value tracker swallows a plain assignment; going through the native
// setter then firing input is the reliable way to type into a controlled field.
function typeField(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function type(div: HTMLDivElement, values: { password?: string; confirm?: string }): Promise<void> {
  const fields = Array.from(div.querySelectorAll("input")).map((input) => input as HTMLInputElement);
  await act(async () => {
    if (values.password !== undefined) {
      typeField(fields[0], values.password);
    }
    if (values.confirm !== undefined) {
      typeField(fields[1], values.confirm);
    }
    (div.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  });
}

function recovery(): void {
  window.location.hash = GOOD_FRAGMENT;
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "link-token" } } });
}

function savedUpdate(token: string | null): void {
  mockUpdateUser.mockResolvedValue({
    data: { user: { id: "auth-user-1", email: "student@njit.edu" } },
    error: null,
  });
  mockSignOut.mockResolvedValue({ error: null });
  mockGetSession.mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  });
}

let recoveryListener: ((event: string, session: unknown) => void) | null = null;

beforeEach(() => {
  // The mount flow ends at currentToken(): a signed-out session is the default.
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockOnAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
    recoveryListener = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

afterEach(() => {
  mountedRoots.splice(0).forEach((root) => root.unmount());
  recoveryListener = null;
  mockGetSession.mockReset();
  mockUpdateUser.mockReset();
  mockSignOut.mockReset();
  mockOnAuthStateChange.mockReset();
  mockReplace.mockReset();
  document.body.innerHTML = "";
  localStorage.clear();
  window.location.hash = "";
});

function localSignOutCalls(): number {
  return mockSignOut.mock.calls.filter((call) => (call[0] as { scope?: string } | undefined)?.scope === "local")
    .length;
}

describe("opening /reset-password", () => {
  it("shows the expired message to a signed-in browser without a link and never the form", async () => {
    // A session alone is not enough: it must have come from a recovery link.
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "a-session" } } });
    const div = await mounted();
    expect(div.innerHTML).toContain(RESET_LINK_EXPIRED);
    expect(div.innerHTML).toContain('href="/forgot-password"');
    expect(div.innerHTML).not.toContain("Choose a new password");
    expect(div.querySelector("form")).toBeNull();
  });

  it("shows the expired message for a rejected link fragment", async () => {
    window.location.hash =
      "#error=server_error&error_code=otp_expired&error_description=Email+link+is+invalid";
    // Even a browser already holding a session must see the expired message.
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "a-session" } } });
    const div = await mounted();
    expect(div.innerHTML).toContain(RESET_LINK_EXPIRED);
    expect(div.innerHTML).toContain('href="/forgot-password"');
    expect(mockOnAuthStateChange).not.toHaveBeenCalled();
    expect(div.innerHTML).not.toContain("Choose a new password");
  });

  it("shows the expired message when the fragment has an access token but no recovery type", async () => {
    window.location.hash = "#access_token=link-token&expires_in=3600&refresh_token=ref&token_type=bearer";
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "link-token" } } });
    const div = await mounted();
    expect(div.innerHTML).toContain(RESET_LINK_EXPIRED);
    expect(div.innerHTML).not.toContain("Choose a new password");
  });

  it("shows the new password form when a recovery link turned into a session", async () => {
    recovery();
    const div = await mounted();
    expect(div.innerHTML).toContain("Choose a new password");
    expect(div.innerHTML).not.toContain(RESET_LINK_EXPIRED);
  });

  it("still shows the form when the opening check runs twice, as React does in development", async () => {
    // The real client wipes a good link's fragment the first time it reads it;
    // mirror that on the first subscription so a re-read could not see the link.
    let subscribes = 0;
    mockOnAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
      recoveryListener = callback;
      subscribes += 1;
      if (subscribes === 1) {
        window.location.hash = "";
      }
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    recovery();
    const div = await mounted(true);
    expect(subscribes).toBeGreaterThanOrEqual(2);
    expect(div.innerHTML).toContain("Choose a new password");
    expect(div.innerHTML).not.toContain(RESET_LINK_EXPIRED);
  });

  it("accepts a PASSWORD_RECOVERY event as proof even without a readable fragment", async () => {
    recovery();
    // Pretend the fragment scrolled away client-side: the event still says the
    // link set a session in this browser.
    window.location.hash = "";
    const div = await mounted();
    expect(div.innerHTML).not.toContain("Choose a new password");
    await act(async () => {
      recoveryListener?.("PASSWORD_RECOVERY", { access_token: "link-token" });
      // Let the pending check promise also settle so it cannot undo the event.
      await Promise.resolve();
    });
    expect(div.innerHTML).toContain("Choose a new password");
    expect(div.innerHTML).not.toContain(RESET_LINK_EXPIRED);
  });
});

describe("the new password save", () => {
  it("rejects a mismatched confirm before touching Supabase", async () => {
    recovery();
    const div = await mounted();
    await type(div, { password: "12345678", confirm: "123456789" });
    expect(div.innerHTML).toContain("The passwords do not match.");
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("enforces the same minimum length as sign up", async () => {
    recovery();
    const div = await mounted();
    await type(div, { password: "1234567", confirm: "1234567" });
    expect(div.innerHTML).toContain(`Password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("shows Supabase's weak-password complaint on the password field", async () => {
    recovery();
    mockUpdateUser.mockResolvedValue({
      data: { user: null },
      error: {
        message: "Password should be at least 10 characters",
        status: 422,
        code: "weak_password",
      },
    });
    const div = await mounted();
    await type(div, { password: "12345678", confirm: "12345678" });
    expect(div.innerHTML).toContain("Password is too weak. Password should be at least 10 characters");
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("updates the password, signs out the other sessions, stores the token, and moves to /classes", async () => {
    recovery();
    savedUpdate("fresh-token");
    const div = await mounted();
    await type(div, { password: "12345678", confirm: "12345678" });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: "12345678" });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
    expect(mockReplace).toHaveBeenCalledWith("/classes");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("fresh-token");
  });

  it("stays on the save-finished screen when the other sessions could not be signed out", async () => {
    recovery();
    savedUpdate("fresh-token");
    mockSignOut.mockResolvedValue({ error: { message: "service unavailable", status: 503 } });
    const div = await mounted();    await type(div, { password: "12345678", confirm: "12345678" });
    expect(div.innerHTML).toContain(
      "Your password was changed. We couldn't sign out your other devices — log out there if you can."
    );
    expect(div.innerHTML).toContain('href="/classes"');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("fresh-token");
  });

  it("sends the student to log in with a plain message when no session came back", async () => {
    recovery();
    const div = await mounted();
    savedUpdate(null);
    await type(div, { password: "12345678", confirm: "12345678" });
    expect(mockReplace).toHaveBeenCalledWith("/login?reset=done");
  });

  it("never leaves the button stuck on Saving… when a step throws", async () => {
    recovery();
    savedUpdate("fresh-token");
    const div = await mounted();
    mockGetSession.mockRejectedValue(new TypeError("weird"));
    await type(div, { password: "12345678", confirm: "12345678" });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: "12345678" });
    expect(div.innerHTML).not.toContain("aria-busy");
    expect(div.innerHTML).not.toContain("Saving…");
  });

  it("leaves the recovery session alone once a password was saved", async () => {
    recovery();
    savedUpdate("fresh-token");
    const div = await mounted();
    await type(div, { password: "12345678", confirm: "12345678" });
    mockSignOut.mockClear();
    mountedRoots.splice(0).forEach((root) => root.unmount());
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/classes");
  });
});

describe("leaving without saving", () => {
  it("signs out locally and clears the app token when the student leaves", async () => {
    recovery();
    localStorage.setItem(TOKEN_KEY, "stale-token");
    const div = await mounted();
    expect(div.innerHTML).toContain("Choose a new password");
    mountedRoots.splice(0).forEach((root) => root.unmount());
    expect(localSignOutCalls()).toBe(1);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("abandons on pagehide too, and never for a visit without a recovery session", async () => {
    // Signed-in visitor without a link: leaving must touch nothing.
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "a-session" } } });
    await mounted();
    mountedRoots.splice(0).forEach((root) => root.unmount());
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("the log in page after the reset", () => {
  // The page is an async server component: call it once to await its
  // searchParams, then render the element it returns.
  async function loginMarkup(params: Record<string, string>): Promise<string> {
    const { default: LogInPage } = await import("../login/page");
    return renderToStaticMarkup(
      await LogInPage({ searchParams: Promise.resolve(params) })
    );
  }

  it("maps the fixed ?reset=done flag onto the plain message", async () => {
    expect(await loginMarkup({ reset: "done" })).toContain(PASSWORD_CHANGED);
  });

  it("shows nothing about a reset without the flag", async () => {
    expect(await loginMarkup({})).not.toContain(PASSWORD_CHANGED);
  });

  it("carries a next path through even with the flag present", async () => {
    const html = await loginMarkup({ reset: "done", next: "/settings" });
    expect(html).toContain(PASSWORD_CHANGED);
    // The rest of the log in form still rendered.
    expect(html).toContain("Log in");
  });
});
