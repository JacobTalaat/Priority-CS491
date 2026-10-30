// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockReplace: vi.fn().mockResolvedValue(undefined),
  mockUnsubscribeBeforeLogout: vi.fn(),
  mockLogOut: vi.fn().mockResolvedValue(undefined),
  mockClearToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.mockReplace }),
}));

vi.mock("@/lib/auth-client", () => ({
  logOut: mocks.mockLogOut,
}));

vi.mock("@/lib/push-client", () => ({
  unsubscribeBeforeLogout: mocks.mockUnsubscribeBeforeLogout,
}));

vi.mock("@/lib/session", () => ({
  clearToken: mocks.mockClearToken,
}));

import { LogOutButton } from "./log-out-button";

describe("LogOutButton", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    mocks.mockReplace.mockClear();
    mocks.mockUnsubscribeBeforeLogout.mockReset();
    mocks.mockLogOut.mockReset().mockResolvedValue(undefined);
    mocks.mockClearToken.mockReset();
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

  it("schedules push cleanup before clearing the token, then redirects to login", async () => {
    const order: string[] = [];
    mocks.mockUnsubscribeBeforeLogout.mockImplementation(() => {
      order.push("push cleanup scheduled");
    });
    mocks.mockClearToken.mockImplementation(() => {
      order.push("token cleared");
    });

    await act(async () => {
      root.render(<LogOutButton />);
    });
    const button = [...container.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Log out"),
    );
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });

    expect(order).toEqual(["push cleanup scheduled", "token cleared"]);
    expect(mocks.mockReplace).toHaveBeenCalledWith("/login");
    expect(
      mocks.mockUnsubscribeBeforeLogout.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.mockLogOut.mock.invocationCallOrder[0]);
  });

  it("completes logout even when push cleanup fails", async () => {
    mocks.mockUnsubscribeBeforeLogout.mockImplementation(() => {
      throw new Error("push broken");
    });

    await act(async () => {
      root.render(<LogOutButton />);
    });
    const button = container.querySelector("button");
    await act(async () => {
      button?.click();
    });

    expect(mocks.mockClearToken).toHaveBeenCalled();
    expect(mocks.mockReplace).toHaveBeenCalledWith("/login");
  });
});
