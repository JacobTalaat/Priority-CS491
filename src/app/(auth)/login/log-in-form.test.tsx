// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The form drives both halves of sign in: the Supabase password request and,
// for a student with two factor on, the code and recovery steps on top.
const mocks = vi.hoisted(() => ({
  mockReplace: vi.fn().mockResolvedValue(undefined),
  mockLogIn: vi.fn(),
  mockCurrentToken: vi.fn(),
  mockPendingCodeStep: vi.fn(),
  mockVerifiedTotpFactorId: vi.fn(),
  mockVerifyAuthenticatorCode: vi.fn(),
  mockRecoverTwoFactor: vi.fn(),
  mockSetToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.mockReplace }),
}));

vi.mock("@/lib/auth-client", () => ({
  logIn: mocks.mockLogIn,
  validateLogIn: (values: { email: string; password: string }) => {
    const errors: Record<string, string> = {};
    if (!values.email.trim()) errors.email = "Enter your email.";
    if (!values.password) errors.password = "Enter your password.";
    return errors;
  },
  currentToken: mocks.mockCurrentToken,
  PASSWORD_CHANGED: "Your password was changed. Log in with your new password.",
  WRONG_CREDENTIALS: "Wrong email or password. Check them and try again.",
  CONFIRM_EMAIL_PATH: "/auth/confirm",
  MIN_PASSWORD_LENGTH: 8,
  signUp: vi.fn(),
}));

vi.mock("@/lib/two-factor-client", () => ({
  pendingCodeStep: mocks.mockPendingCodeStep,
  verifiedTotpFactorId: mocks.mockVerifiedTotpFactorId,
  verifyAuthenticatorCode: mocks.mockVerifyAuthenticatorCode,
  recoverTwoFactor: mocks.mockRecoverTwoFactor,
  enrollAuthenticator: vi.fn(),
  unenrollPendingFactor: vi.fn(),
  twoFactorStatus: vi.fn(),
  enableTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  setToken: mocks.mockSetToken,
  clearToken: vi.fn(),
  getToken: vi.fn(),
}));

import { LogInForm } from "./log-in-form";

const GOOD_TOKEN = "good-password-token";
const AAL2_TOKEN = "good-aal2-token";

function passwordAccepted(step: "none" | "code") {
  mocks.mockLogIn.mockResolvedValue({
    ok: true,
    token: GOOD_TOKEN,
    user: { id: "user-1", email: "student@example.com" },
  });
  mocks.mockPendingCodeStep.mockResolvedValue({ step });
}

describe("LogInForm", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.mockReplace.mockResolvedValue(undefined);
    mocks.mockCurrentToken.mockResolvedValue(GOOD_TOKEN);
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

  function findButton(label: string): HTMLButtonElement | null {
    const buttons = [...container.querySelectorAll("button")];
    return buttons.find((button) => button.textContent?.includes(label)) ?? null;
  }

  // React tracks the input's value through its own setter, so typing here has
  // to go around it the way the browser would.
  function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
      ?.set as (value: string) => void;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function submitCredentials() {
    const email = container.querySelector<HTMLInputElement>('input[name="email"]');
    const password = container.querySelector<HTMLInputElement>('input[name="password"]');
    const form = container.querySelector("form");
    expect(email).not.toBeNull();
    expect(password).not.toBeNull();
    await act(async () => {
      typeInto(email!, "student@example.com");
      typeInto(password!, "correct-password");
    });
    await act(async () => {
      form?.requestSubmit();
    });
  }

  async function typeAndSubmitCodeStep(value: string) {
    const codeInput = container.querySelector<HTMLInputElement>('input[name="authenticator-code"]');
    expect(codeInput).not.toBeNull();
    await act(async () => {
      typeInto(codeInput!, value);
    });
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
  }

  async function typeAndSubmitRecoveryCode(value: string) {
    const codeInput = container.querySelector<HTMLInputElement>('input[name="recovery-code"]');
    expect(codeInput).not.toBeNull();
    await act(async () => {
      typeInto(codeInput!, value);
    });
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
  }

  it("logs straight in for a student who never turned two factor on", async () => {
    passwordAccepted("none");
    await act(async () => {
      root.render(<LogInForm next="/today" />);
    });
    await submitCredentials();
    expect(mocks.mockSetToken).toHaveBeenCalledWith(GOOD_TOKEN);
    expect(mocks.mockReplace).toHaveBeenCalledWith("/today");
  });

  it("shows the code step instead of finishing when Supabase asks for the second factor", async () => {
    passwordAccepted("code");
    await act(async () => {
      root.render(<LogInForm next="/today" />);
    });
    await submitCredentials();
    expect(container.textContent).toContain("Authenticator code");
    // The password-only token is never handed out on its own: log in is not
    // finished until the code step passes.
    expect(mocks.mockSetToken).not.toHaveBeenCalled();
    expect(mocks.mockReplace).not.toHaveBeenCalled();
  });

  it("completes the log in with the promoted aal2 token after a correct code", async () => {
    passwordAccepted("code");
    await act(async () => {
      root.render(<LogInForm next="/today" />);
    });
    await submitCredentials();
    mocks.mockVerifiedTotpFactorId.mockResolvedValue("factor-1");
    mocks.mockVerifyAuthenticatorCode.mockResolvedValue({ ok: true, token: AAL2_TOKEN });
    await typeAndSubmitCodeStep("123456");
    expect(mocks.mockVerifyAuthenticatorCode).toHaveBeenCalledWith("factor-1", "123456");
    expect(mocks.mockSetToken).toHaveBeenCalledWith(AAL2_TOKEN);
    expect(mocks.mockReplace).toHaveBeenCalledWith("/today");
  });

  it("shows the inline error and stays on the code step for a wrong code", async () => {
    passwordAccepted("code");
    await act(async () => {
      root.render(<LogInForm next="/today" />);
    });
    await submitCredentials();
    mocks.mockVerifiedTotpFactorId.mockResolvedValue("factor-1");
    mocks.mockVerifyAuthenticatorCode.mockResolvedValue({ ok: false });
    await typeAndSubmitCodeStep("111111");
    expect(container.textContent).toContain("That code is not right. Try again.");
    expect(mocks.mockSetToken).not.toHaveBeenCalled();
    expect(mocks.mockReplace).not.toHaveBeenCalled();
  });

  it("offers the recovery code path and completes the log in after it", async () => {
    passwordAccepted("code");
    mocks.mockRecoverTwoFactor.mockResolvedValue({ ok: true, status: 200, data: { recovered: true } });
    await act(async () => {
      root.render(<LogInForm next="/today" />);
    });
    await submitCredentials();
    const useRecovery = findButton("Use a recovery code instead");
    expect(useRecovery).not.toBeNull();
    await act(async () => {
      useRecovery?.click();
    });
    expect(container.textContent).toContain("Recovery code");
    await typeAndSubmitRecoveryCode("abcd-efgh-jk");
    expect(mocks.mockRecoverTwoFactor).toHaveBeenCalledWith("abcd-efgh-jk", GOOD_TOKEN);
    // Two factor is off now, so the still password-only token completes.
    expect(mocks.mockSetToken).toHaveBeenCalledWith(GOOD_TOKEN);
    expect(mocks.mockReplace).toHaveBeenCalledWith("/today");
  });

  it("surfaces the recovery answer's error inline without leaving the step", async () => {
    passwordAccepted("code");
    mocks.mockRecoverTwoFactor.mockResolvedValue({
      ok: false,
      status: 400,
      error: "That recovery code is not right.",
    });
    await act(async () => {
      root.render(<LogInForm next="/today" />);
    });
    await submitCredentials();
    await act(async () => {
      findButton("Use a recovery code instead")?.click();
    });
    await typeAndSubmitRecoveryCode("2222-3333-44");
    expect(container.textContent).toContain("That recovery code is not right.");
    expect(mocks.mockSetToken).not.toHaveBeenCalled();
    expect(mocks.mockReplace).not.toHaveBeenCalled();
  });
});
