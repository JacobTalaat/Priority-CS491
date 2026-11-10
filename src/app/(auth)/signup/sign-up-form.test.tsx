// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  signUp: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/lib/auth-client", () => ({
  MIN_PASSWORD_LENGTH: 8,
  signUp: mocks.signUp,
  validateSignUp: () => ({}),
}));

vi.mock("@/lib/session", () => ({
  setToken: mocks.setToken,
}));

import { SignUpForm } from "./sign-up-form";

describe("SignUpForm", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.signUp.mockReset().mockResolvedValue({ ok: true, token: "new-session" });
    mocks.setToken.mockReset();
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

  it("sends a new student to first-run onboarding after account creation", async () => {
    await act(async () => {
      root.render(<SignUpForm />);
    });
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });

    expect(mocks.setToken).toHaveBeenCalledWith("new-session");
    expect(mocks.replace).toHaveBeenCalledWith("/onboarding");
  });
});
