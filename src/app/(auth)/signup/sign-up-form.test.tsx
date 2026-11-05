// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockSignUp: vi.fn(),
  mockSetToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.mockReplace }),
}));

vi.mock("@/lib/auth-client", () => ({
  MIN_PASSWORD_LENGTH: 8,
  signUp: mocks.mockSignUp,
  validateSignUp: (values: { email: string; password: string }) => {
    const errors: Record<string, string> = {};
    if (!values.email.trim()) errors.email = "Enter your email.";
    if (values.password.length < 8) errors.password = "Password is too weak.";
    return errors;
  },
}));

vi.mock("@/lib/session", () => ({
  setToken: mocks.mockSetToken,
}));

import { SignUpForm } from "./sign-up-form";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.mockReplace.mockReset();
  mocks.mockSetToken.mockReset();
  mocks.mockSignUp.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("SignUpForm", () => {
  it("starts the onboarding flow after creating an account", async () => {
    mocks.mockSignUp.mockResolvedValue({
      ok: true,
      token: "session-token",
      user: { id: "user-1", email: "student@school.edu" },
    });

    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      root.render(<SignUpForm />);
    });

    const email = container.querySelector<HTMLInputElement>('input[name="email"]');
    const password = container.querySelector<HTMLInputElement>('input[name="password"]');
    const form = container.querySelector("form");
    expect(email).not.toBeNull();
    expect(password).not.toBeNull();
    expect(form).not.toBeNull();

    await act(async () => {
      const emailSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      emailSetter?.call(email, "student@school.edu");
      email?.dispatchEvent(new Event("input", { bubbles: true }));
      const passwordSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      passwordSetter?.call(password, "password123");
      password?.dispatchEvent(new Event("input", { bubbles: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.mockSetToken).toHaveBeenCalledWith("session-token");
    expect(mocks.mockReplace).toHaveBeenCalledWith("/onboarding");
  });
});
