// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown> & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const { mockReset, mockOnAuthStateChange, mockReplace } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
  const client = {
    auth: {
      getSession: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  };
  return {
    mockReset: client.auth.resetPasswordForEmail,
    mockOnAuthStateChange: client.auth.onAuthStateChange,
    mockReplace: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(),
      resetPasswordForEmail: mockReset,
      updateUser: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: mockOnAuthStateChange,
    },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

import { RESET_COULD_NOT_SEND, RESET_LINK_SENT } from "@/lib/auth-client";
import { ForgotPasswordForm } from "./forgot-password-form";

// React's value tracker swallows a plain assignment; going through the native
// setter then firing input is the reliable way to type into a controlled field.
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function mounted(): Promise<{ div: HTMLElement; root: { unmount(): void } }> {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(<ForgotPasswordForm />);
  });
  return { div, root };
}

async function submittedHtml(email: string, outcome: unknown): Promise<string> {
  mockReset.mockReset();
  if (outcome instanceof Error) {
    mockReset.mockRejectedValue(outcome);
  } else {
    mockReset.mockResolvedValue(outcome);
  }
  const { div, root } = await mounted();
  await act(async () => {
    type(div.querySelector("input")!, email);
    (div.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  });
  const html = div.innerHTML;
  root.unmount();
  // useId ids differ from mount to mount; strip them so the markup can compare equal.
  return html.replace(/_r_[0-9a-z_]+/g, "id");
}

afterEach(() => {
  mockReset.mockReset();
  document.body.innerHTML = "";
});

describe("ForgotPasswordForm", () => {
  it("shows the identical message for success, an unknown address, and a rate limit", async () => {
    const success = await submittedHtml("student@njit.edu", { data: {}, error: null });
    const unknownAddress = await submittedHtml("nobody@njit.edu", {
      data: {},
      error: { message: "Email not found", status: 400, code: "user_not_found" },
    });
    const rateLimited = await submittedHtml("student@njit.edu", {
      data: {},
      error: { message: "Rate limit exceeded", status: 429 },
    });
    const providerBroken = await submittedHtml("student@njit.edu", {
      data: {},
      error: { message: "Email provider is not configured", status: 500, code: "email_provider_disabled" },
    });
    // Byte-identical rendered markup for every outcome that involved an HTTP
    // exchange: the form cannot be used to find out who is registered.
    expect(unknownAddress).toBe(success);
    expect(rateLimited).toBe(success);
    expect(providerBroken).toBe(success);
    expect(unknownAddress).toContain(RESET_LINK_SENT);
    expect(success).toContain(RESET_LINK_SENT);
  });

  it("tells the student the connection, not anything about accounts, when no HTTP answer came", async () => {
    const unreachable = await submittedHtml("student@njit.edu", {
      data: {},
      error: { message: "Error: fetch failed", status: 0, name: "AuthRetryableFetchError" },
    });
    expect(unreachable).toContain(RESET_COULD_NOT_SEND);
    expect(unreachable).not.toContain(RESET_LINK_SENT);

    const thrown = await submittedHtml("student@njit.edu", new TypeError("network down"));
    expect(thrown).toContain(RESET_COULD_NOT_SEND);
  });

  it("asks for a well-formed email before sending anything", async () => {
    mockReset.mockReset();
    const { div, root } = await mounted();
    await act(async () => {
      (div.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(div.innerHTML).toContain("Enter your email.");
    await act(async () => {
      type(div.querySelector("input")!, "student@");
      (div.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(div.innerHTML).toContain("Enter a valid email, like name@school.edu.");
    expect(mockReset).not.toHaveBeenCalled();
    root.unmount();
  });

  it("asks Supabase to send the reset link pointing at /reset-password", async () => {
    mockReset.mockResolvedValue({ data: {}, error: null });
    const { div, root } = await mounted();
    await act(async () => {
      type(div.querySelector("input")!, " student@njit.edu ");
      (div.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(mockReset).toHaveBeenCalledWith("student@njit.edu", {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    root.unmount();
  });
});

describe("the log in form", () => {
  it('links "Forgot your password?" to the reset form', async () => {
    // The mocks above (router) apply to this client component import too.
    const { LogInForm } = await import("../login/log-in-form");
    const html = renderToStaticMarkup(<LogInForm next="/classes" />);
    expect(html).toMatch(/<a[^>]*href="\/forgot-password"[^>]*>Forgot your password\?<\/a>/);
  });
});
