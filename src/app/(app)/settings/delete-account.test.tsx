// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockDeleteAccount: vi.fn(),
  mockLogOutLocally: vi.fn(),
  mockUnsubscribe: vi.fn(),
  mockClearToken: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.mockReplace }),
}));

vi.mock("@/lib/account-client", () => ({
  deleteAccount: mocks.mockDeleteAccount,
}));

vi.mock("@/lib/auth-client", () => ({
  logOutLocally: mocks.mockLogOutLocally,
}));

vi.mock("@/lib/push-client", () => ({
  unsubscribeBeforeLogout: mocks.mockUnsubscribe,
}));

vi.mock("@/lib/session", () => ({
  clearToken: mocks.mockClearToken,
}));

import { DeleteAccount } from "./delete-account";

const OK_RESULT = { ok: true, status: 200, data: { deleted: true } } as const;

describe("DeleteAccount", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    mocks.mockDeleteAccount.mockReset();
    mocks.mockLogOutLocally.mockReset();
    mocks.mockUnsubscribe.mockReset();
    mocks.mockClearToken.mockReset();
    mocks.mockReplace.mockReset();
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

  async function clickButton(label: string) {
    const button = findButton(label);
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
  }

  function inputLabelled(label: string): HTMLInputElement {
    const labelElement = [...container.querySelectorAll("label")].find((item) => item.textContent === label);
    const input = labelElement ? document.getElementById(labelElement.htmlFor) : null;
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`No input labelled ${label}`);
    }
    return input;
  }

  async function typeInto(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function openFormAndFill(password: string, confirmText: string) {
    await clickButton("Delete account");
    expect(inputLabelled("Password")).not.toBeNull();
    await typeInto(inputLabelled("Password"), password);
    await typeInto(inputLabelled("Type DELETE to confirm"), confirmText);
  }

  it("keeps the confirmation form hidden until Delete account is clicked", async () => {
    await act(async () => {
      root.render(<DeleteAccount />);
    });
    expect([...container.querySelectorAll("input")]).toEqual([]);

    await clickButton("Delete account");
    expect(inputLabelled("Password")).toBeInstanceOf(HTMLInputElement);
    expect(inputLabelled("Type DELETE to confirm")).toBeInstanceOf(HTMLInputElement);
  });

  it("keeps the submit button disabled until the password is filled and DELETE is typed exactly", async () => {
    await act(async () => {
      root.render(<DeleteAccount />);
    });
    await clickButton("Delete account");
    const submit = findButton("Permanently delete account") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await typeInto(inputLabelled("Password"), "correct-password");
    expect(submit.disabled).toBe(true);

    await typeInto(inputLabelled("Type DELETE to confirm"), "delete");
    expect(submit.disabled).toBe(true);

    await typeInto(inputLabelled("Type DELETE to confirm"), "DELETE");
    expect(submit.disabled).toBe(false);
  });

  it("deletes the account, then signs out locally and goes home", async () => {
    mocks.mockDeleteAccount.mockResolvedValue(OK_RESULT);
    mocks.mockLogOutLocally.mockResolvedValue(undefined);
    await act(async () => {
      root.render(<DeleteAccount />);
    });
    await openFormAndFill("correct-password", "DELETE");
    await clickButton("Permanently delete account");

    expect(mocks.mockDeleteAccount).toHaveBeenCalledWith("correct-password");
    // The order matters: the sign out has to be attempted before the token is
    // forgotten, and the token before the redirect.
    expect(mocks.mockLogOutLocally.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mockClearToken.mock.invocationCallOrder[0]
    );
    expect(mocks.mockClearToken.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mockReplace.mock.invocationCallOrder[0]
    );
    expect(mocks.mockClearToken).toHaveBeenCalledTimes(1);
    expect(mocks.mockReplace).toHaveBeenCalledWith("/");
  });

  it("unsubscribes the browser push subscription before forgetting the token", async () => {
    mocks.mockDeleteAccount.mockResolvedValue(OK_RESULT);
    mocks.mockLogOutLocally.mockResolvedValue(undefined);
    await act(async () => {
      root.render(<DeleteAccount />);
    });
    await openFormAndFill("correct-password", "DELETE");
    await clickButton("Permanently delete account");

    // The unsubscribe reads the token synchronously, so it must run while the
    // token still exists, and its DELETE 401 is expected to be harmless.
    expect(mocks.mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.mockLogOutLocally.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mockUnsubscribe.mock.invocationCallOrder[0]
    );
    expect(mocks.mockUnsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mockClearToken.mock.invocationCallOrder[0]
    );
  });

  it("still forgets the session and goes home when the local sign out fails", async () => {
    mocks.mockDeleteAccount.mockResolvedValue(OK_RESULT);
    mocks.mockLogOutLocally.mockRejectedValue(new Error("sign out failed"));
    await act(async () => {
      root.render(<DeleteAccount />);
    });
    await openFormAndFill("correct-password", "DELETE");
    await clickButton("Permanently delete account");

    expect(mocks.mockClearToken).toHaveBeenCalledTimes(1);
    expect(mocks.mockReplace).toHaveBeenCalledWith("/");
  });

  it("gives up waiting on a stalled local sign out after 3000 ms and goes home", async () => {
    vi.useFakeTimers();
    try {
      mocks.mockDeleteAccount.mockResolvedValue(OK_RESULT);
      mocks.mockLogOutLocally.mockImplementation(() => new Promise(() => {}));
      await act(async () => {
        root.render(<DeleteAccount />);
      });
      await openFormAndFill("correct-password", "DELETE");
      await clickButton("Permanently delete account");
      expect(mocks.mockLogOutLocally).toHaveBeenCalledTimes(1);
      expect(mocks.mockClearToken).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2999);
      });
      expect(mocks.mockClearToken).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(mocks.mockClearToken).toHaveBeenCalledTimes(1);
      expect(mocks.mockReplace).toHaveBeenCalledWith("/");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not unsubscribe the browser's push subscription when the delete fails", async () => {
    mocks.mockDeleteAccount.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Password is incorrect.",
    });
    await act(async () => {
      root.render(<DeleteAccount />);
    });
    await openFormAndFill("correct-password", "DELETE");
    await clickButton("Permanently delete account");

    expect(mocks.mockUnsubscribe).not.toHaveBeenCalled();
    expect(mocks.mockLogOutLocally).not.toHaveBeenCalled();
  });

  it("shows the server's error, clears the password, and stays signed in", async () => {
    mocks.mockDeleteAccount.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Password is incorrect.",
    });
    await act(async () => {
      root.render(<DeleteAccount />);
    });
    await openFormAndFill("correct-password", "DELETE");
    await clickButton("Permanently delete account");

    expect(findButton("Permanently delete account")).not.toBeNull();
    expect(container.textContent).toContain("Password is incorrect.");
    expect(mocks.mockLogOutLocally).not.toHaveBeenCalled();
    expect(mocks.mockClearToken).not.toHaveBeenCalled();
    expect(mocks.mockReplace).not.toHaveBeenCalled();
    expect(inputLabelled("Password").value).toBe("");
  });

  it("hides the form and clears the fields on Cancel", async () => {
    await act(async () => {
      root.render(<DeleteAccount />);
    });
    await openFormAndFill("correct-password", "DELETE");
    await clickButton("Cancel");

    expect(findButton("Delete account")).not.toBeNull();
    expect(findButton("Permanently delete account")).toBeNull();
    // Reopening starts from clean fields.
    await clickButton("Delete account");
    expect(inputLabelled("Password").value).toBe("");
    expect(inputLabelled("Type DELETE to confirm").value).toBe("");
  });
});
