import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkConfirmAllowed,
  clearFailedConfirms,
  CONFIRM_WINDOW_MS,
  MAX_CONFIRM_ATTEMPTS,
  MAX_TRACKED_ACCOUNTS,
  recordFailedConfirm,
  resetConfirmLimitForTests,
} from "./confirm-password-limit";

describe("confirm password limit", () => {
  beforeEach(() => {
    resetConfirmLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  });

  it("allows the configured attempts and blocks the next one", () => {
    for (let index = 0; index < MAX_CONFIRM_ATTEMPTS; index += 1) {
      expect(checkConfirmAllowed("user-1").allowed).toBe(true);
      recordFailedConfirm("user-1");
    }
    const blocked = checkConfirmAllowed("user-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("allows attempts again once the window expires", () => {
    for (let index = 0; index < MAX_CONFIRM_ATTEMPTS; index += 1) {
      recordFailedConfirm("user-1");
    }
    vi.setSystemTime(new Date(Date.now() + CONFIRM_WINDOW_MS + 1000));
    expect(checkConfirmAllowed("user-1").allowed).toBe(true);
  });

  it("a success clears the count", () => {
    for (let index = 0; index < MAX_CONFIRM_ATTEMPTS; index += 1) {
      recordFailedConfirm("user-1");
    }
    clearFailedConfirms("user-1");
    expect(checkConfirmAllowed("user-1").allowed).toBe(true);
  });

  it("limits one account without affecting another", () => {
    for (let index = 0; index < MAX_CONFIRM_ATTEMPTS; index += 1) {
      recordFailedConfirm("user-1");
    }
    expect(checkConfirmAllowed("user-1").allowed).toBe(false);
    expect(checkConfirmAllowed("user-2").allowed).toBe(true);
  });

  it("stops tracking new accounts once the table is full so memory cannot grow without limit", () => {
    for (let index = 0; index < MAX_TRACKED_ACCOUNTS; index += 1) {
      recordFailedConfirm(`flood-${index}`);
    }
    expect(checkConfirmAllowed("brand-new").allowed).toBe(false);
  });

  it("a flood does not erase a targeted account's counter", () => {
    for (let index = 0; index < MAX_CONFIRM_ATTEMPTS; index += 1) {
      recordFailedConfirm("victim");
    }
    for (let index = 0; index < MAX_TRACKED_ACCOUNTS; index += 1) {
      recordFailedConfirm(`flood-${index}`);
    }
    expect(checkConfirmAllowed("victim").allowed).toBe(false);
  });
});
