// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockDeleteAccount: vi.fn(),
  mockClearToken: vi.fn(),
  mockUnsubscribeBeforeLogout: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.mockReplace }),
}));

vi.mock("@/lib/account-client", () => ({
  deleteAccount: mocks.mockDeleteAccount,
}));

vi.mock("@/lib/session", () => ({
  clearToken: mocks.mockClearToken,
}));

vi.mock("@/lib/push-client", () => ({
  unsubscribeBeforeLogout: mocks.mockUnsubscribeBeforeLogout,
}));

import { AccountControls } from "./account-controls";

describe("AccountControls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.mockDeleteAccount.mockReset();
    mocks.mockClearToken.mockReset();
    mocks.mockUnsubscribeBeforeLogout.mockReset();
    mocks.mockReplace.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function renderControls() {
    await act(async () => {
      root.render(<AccountControls />);
    });
  }

  function buttonNamed(name: string): HTMLButtonElement {
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === name);
    if (!button) {
      throw new Error(`No button named ${name}`);
    }
    return button;
  }

  async function typeInto(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("requires the student to open a confirmation step before deletion", async () => {
    await renderControls();

    expect(container.querySelector("form")).toBeNull();
    await act(async () => {
      buttonNamed("Delete account").click();
    });

    expect(container.textContent).toContain("I understand this action cannot be undone.");
    expect(container.querySelector('input[name="deleteAccountPassword"]')).not.toBeNull();
    expect(buttonNamed("Permanently delete account").disabled).toBe(true);
    expect(mocks.mockDeleteAccount).not.toHaveBeenCalled();
  });

  it("requires password and explicit acknowledgement, then deletes and clears the session", async () => {
    mocks.mockDeleteAccount.mockResolvedValue({ ok: true, status: 200, data: { deleted: true } });
    await renderControls();

    await act(async () => {
      buttonNamed("Delete account").click();
    });
    const password = container.querySelector<HTMLInputElement>('input[name="deleteAccountPassword"]');
    const confirmation = container.querySelector<HTMLInputElement>('input[name="confirmAccountDeletion"]');
    expect(password).not.toBeNull();
    expect(confirmation).not.toBeNull();
    await typeInto(password!, "correct-password");
    expect(buttonNamed("Permanently delete account").disabled).toBe(true);
    await act(async () => {
      confirmation?.click();
    });

    expect(buttonNamed("Permanently delete account").disabled).toBe(false);
    await act(async () => {
      buttonNamed("Permanently delete account").click();
    });

    expect(mocks.mockDeleteAccount).toHaveBeenCalledWith("correct-password");
    expect(mocks.mockUnsubscribeBeforeLogout).toHaveBeenCalledTimes(1);
    expect(mocks.mockClearToken).toHaveBeenCalledTimes(1);
    expect(mocks.mockReplace).toHaveBeenCalledWith("/signup");
  });

  it("keeps the confirmation open and displays API errors", async () => {
    mocks.mockDeleteAccount.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Password is incorrect.",
    });
    await renderControls();

    await act(async () => {
      buttonNamed("Delete account").click();
    });
    const password = container.querySelector<HTMLInputElement>('input[name="deleteAccountPassword"]');
    const confirmation = container.querySelector<HTMLInputElement>('input[name="confirmAccountDeletion"]');
    await typeInto(password!, "wrong-password");
    await act(async () => {
      confirmation?.click();
    });
    await act(async () => {
      buttonNamed("Permanently delete account").click();
    });

    expect(container.textContent).toContain("Password is incorrect.");
    expect(container.querySelector("form")).not.toBeNull();
    expect(mocks.mockClearToken).not.toHaveBeenCalled();
    expect(mocks.mockReplace).not.toHaveBeenCalled();
  });
});
