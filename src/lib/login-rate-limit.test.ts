import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkLoginAllowed,
  clearFailedLogins,
  MAX_FAILED_ATTEMPTS,
  recordFailedLogin,
  resetLoginRateLimitForTests,
  WINDOW_MS,
  MAX_TRACKED_ACCOUNTS,
} from "./login-rate-limit";

describe("login rate limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    resetLoginRateLimitForTests();
  });

  it("allows five failures and blocks the sixth check", () => {
    for (let attempt = 1; attempt <= MAX_FAILED_ATTEMPTS; attempt += 1) {
      expect(checkLoginAllowed("student@example.com").allowed).toBe(true);
      recordFailedLogin("student@example.com");
    }
    const result = checkLoginAllowed("student@example.com");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBe(900);
    }
  });

  it("allows another attempt after the anchored window expires", () => {
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      recordFailedLogin("student@example.com");
    }
    vi.advanceTimersByTime(WINDOW_MS);
    expect(checkLoginAllowed("student@example.com")).toEqual({ allowed: true });
    recordFailedLogin("student@example.com");
    expect(checkLoginAllowed("student@example.com")).toEqual({ allowed: true });
  });

  it("normalizes case and whitespace to one key", () => {
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      recordFailedLogin("  STUDENT@EXAMPLE.COM ");
    }
    expect(checkLoginAllowed("student@example.com").allowed).toBe(false);
  });

  it("clears failures", () => {
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      recordFailedLogin("student@example.com");
    }
    clearFailedLogins("student@example.com");
    expect(checkLoginAllowed("student@example.com")).toEqual({ allowed: true });
  });

  it("stops tracking new accounts once the table is full, so memory cannot grow without limit", () => {
    for (let index = 0; index < MAX_TRACKED_ACCOUNTS; index += 1) {
      recordFailedLogin(`flood-${index}@example.com`);
    }
    expect(checkLoginAllowed("brand-new@example.com")).toEqual({
      allowed: false,
      retryAfterSeconds: WINDOW_MS / 1000,
    });
  });

  it("frees the table again once the flood windows expire", () => {
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    for (let index = 0; index < MAX_TRACKED_ACCOUNTS; index += 1) {
      recordFailedLogin(`flood-${index}@example.com`);
    }
    vi.setSystemTime(new Date(Date.now() + WINDOW_MS + 1000));
    expect(checkLoginAllowed("brand-new@example.com")).toEqual({ allowed: true });
  });

  it("a flood of unknown emails does not erase a targeted account's counter", () => {
    for (let index = 0; index < MAX_FAILED_ATTEMPTS; index += 1) {
      recordFailedLogin("victim@example.com");
    }
    for (let index = 0; index < MAX_TRACKED_ACCOUNTS; index += 1) {
      recordFailedLogin(`flood-${index}@example.com`);
    }
    expect(checkLoginAllowed("victim@example.com").allowed).toBe(false);
  });
});
