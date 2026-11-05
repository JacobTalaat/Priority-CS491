import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockOnSessionChange, mockGetToken, mockSetToken, mockClearToken, unsubscribe, handlers } =
  vi.hoisted(() => {
    const handlers: Array<(token: string | null) => void> = [];
    const unsubscribe = vi.fn();
    const onSessionChange = vi.fn((handler: (token: string | null) => void) => {
      handlers.push(handler);
      return unsubscribe;
    });
    return {
      mockOnSessionChange: onSessionChange,
      mockGetToken: vi.fn(),
      mockSetToken: vi.fn(),
      mockClearToken: vi.fn(),
      unsubscribe,
      handlers,
    };
  });

vi.mock("@/lib/auth-client", () => ({
  onSessionChange: mockOnSessionChange,
}));

vi.mock("@/lib/session", () => ({
  getToken: mockGetToken,
  setToken: mockSetToken,
  clearToken: mockClearToken,
}));

import { startSessionSync } from "./session-sync";

describe("startSessionSync", () => {
  let onSignedOutCalls = 0;
  const onSignedOut = () => {
    onSignedOutCalls += 1;
  };

  beforeEach(() => {
    handlers.length = 0;
    onSignedOutCalls = 0;
    unsubscribe.mockClear();
    mockOnSessionChange.mockClear();
    mockGetToken.mockReset();
    mockSetToken.mockReset();
    mockClearToken.mockReset();
  });

  it("updates the stored token as soon as a refreshed session arrives", () => {
    mockGetToken.mockReturnValue("stale-token");
    startSessionSync(onSignedOut);
    expect(handlers).toHaveLength(1);
    handlers[0]("fresh-token");
    expect(mockSetToken).toHaveBeenCalledWith("fresh-token");
    expect(onSignedOutCalls).toBe(0);
  });

  it("does not rewrite a token that the storage already holds", () => {
    mockGetToken.mockReturnValue("same-token");
    startSessionSync(onSignedOut);
    handlers[0]("same-token");
    expect(mockSetToken).not.toHaveBeenCalled();
  });

  it("clears the token and reports the sign-out when the session ends", () => {
    startSessionSync(onSignedOut);
    handlers[0](null);
    expect(mockClearToken).toHaveBeenCalledTimes(1);
    expect(onSignedOutCalls).toBe(1);
    expect(mockSetToken).not.toHaveBeenCalled();
  });

  it("returns the unsubscribe from Supabase for the component cleanup", () => {
    const stop = startSessionSync(onSignedOut);
    expect(handlers).toHaveLength(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onSignedOutCalls).toBe(0);
  });
});
