import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAndReserveTestSend,
  MAX_TEST_SENDS,
  refundTestSend,
  resetTestSendLimitForTests,
  TEST_WINDOW_MS,
} from "./push-test-limit";

describe("push test limit", () => {
  beforeEach(() => {
    resetTestSendLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T18:00:00Z"));
  });

  it("allows the configured sends and blocks the one after them", () => {
    for (let index = 0; index < MAX_TEST_SENDS; index += 1) {
      expect(checkAndReserveTestSend("user-1").allowed).toBe(true);
    }
    const blocked = checkAndReserveTestSend("user-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reserves a slot in the same synchronous step it is checked", () => {
    expect(checkAndReserveTestSend("user-1").allowed).toBe(true);
    expect(checkAndReserveTestSend("user-1").allowed).toBe(true);
    expect(checkAndReserveTestSend("user-1").allowed).toBe(true);
    // Without a reservation step between check and record the second call
    // could still read sends=0; the counter already says two here.
    expect(checkAndReserveTestSend("user-1").allowed).toBe(false);
  });

  it("gives the slot back when nothing was sent", () => {
    for (let index = 0; index < MAX_TEST_SENDS; index += 1) {
      checkAndReserveTestSend("user-1");
    }
    expect(checkAndReserveTestSend("user-1").allowed).toBe(false);
    refundTestSend("user-1");
    expect(checkAndReserveTestSend("user-1").allowed).toBe(true);
  });

  it("allows sends again once the window expires", () => {
    for (let index = 0; index < MAX_TEST_SENDS; index += 1) {
      checkAndReserveTestSend("user-1");
    }
    vi.setSystemTime(new Date(Date.now() + TEST_WINDOW_MS + 1000));
    expect(checkAndReserveTestSend("user-1").allowed).toBe(true);
  });

  it("limits one account without affecting another", () => {
    for (let index = 0; index < MAX_TEST_SENDS; index += 1) {
      checkAndReserveTestSend("user-1");
    }
    expect(checkAndReserveTestSend("user-1").allowed).toBe(false);
    expect(checkAndReserveTestSend("user-2").allowed).toBe(true);
  });

  it("starts a fresh window once the old window expired", () => {
    for (let index = 0; index < MAX_TEST_SENDS; index += 1) {
      checkAndReserveTestSend("user-1");
    }
    vi.setSystemTime(new Date(Date.now() + TEST_WINDOW_MS + 1000));
    checkAndReserveTestSend("user-1");
    expect(checkAndReserveTestSend("user-1").allowed).toBe(true);
  });

  it("a refund without a reservation is harmless", () => {
    refundTestSend("ghost");
    expect(checkAndReserveTestSend("ghost").allowed).toBe(true);
  });
});
