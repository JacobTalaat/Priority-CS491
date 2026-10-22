import { describe, expect, it } from "vitest";
import {
  RESEND_COOLDOWN_SECONDS,
  beginResend,
  finishResend,
  resendLabel,
  secondsLeftAt,
  type ResendState,
} from "./resend-email";

describe("secondsLeftAt", () => {
  it("locks the button for the full cooldown from the moment of send", () => {
    const sent = 1_800_000_000_000;
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(secondsLeftAt(sent + RESEND_COOLDOWN_SECONDS * 1000, sent)).toBe(60);
  });

  it("counts down to the second as the minute passes", () => {
    const sent = 1_800_000_000_000;
    expect(secondsLeftAt(sent + 60_000, sent + 19_000)).toBe(41);
    expect(secondsLeftAt(sent + 60_000, sent + 59_500)).toBe(1);
  });

  it("releases the button the moment the minute is up", () => {
    const sent = 1_800_000_000_000;
    expect(secondsLeftAt(sent + 60_000, sent + 60_000)).toBe(0);
    expect(secondsLeftAt(sent + 60_000, sent + 90_000)).toBe(0);
  });
});

describe("resendLabel", () => {
  it("shows the countdown on the button while it is locked", () => {
    expect(resendLabel("Send it again", 42)).toBe("Send it again (42s)");
    expect(resendLabel("Send a new link", 1)).toBe("Send a new link (1s)");
  });

  it("keeps the plain label when the countdown is over", () => {
    expect(resendLabel("Send it again", 0)).toBe("Send it again");
  });
});

const CLICK = 1_800_000_000_000;

function aState(overrides: Partial<ResendState> = {}): ResendState {
  return { sent: false, failed: false, cooldownEndsAt: 0, ...overrides };
}

describe("beginResend", () => {
  it("locks the button at the moment of the click, before the request resolves", () => {
    expect(beginResend(aState(), "student@njit.edu", CLICK)).toEqual({
      sent: false,
      failed: false,
      cooldownEndsAt: CLICK + RESEND_COOLDOWN_SECONDS * 1000,
    });
  });

  it("refuses a second click made while the first one is still in flight", () => {
    const afterFirstClick = beginResend(aState(), "student@njit.edu", CLICK) as ResendState;
    expect(beginResend(afterFirstClick, "student@njit.edu", CLICK)).toBeNull();
    expect(beginResend(afterFirstClick, "student@njit.edu", CLICK + 20_000)).toBeNull();
  });

  it("lets the button go again once the minute is up", () => {
    const afterFirstClick = beginResend(aState(), "student@njit.edu", CLICK) as ResendState;
    expect(beginResend(afterFirstClick, "student@njit.edu", CLICK + 60_000)).toEqual({
      sent: false,
      failed: false,
      cooldownEndsAt: CLICK + 120_000,
    });
  });

  it("refuses to send without an address", () => {
    expect(beginResend(aState(), null, CLICK)).toBeNull();
    expect(beginResend(aState(), "   ", CLICK)).toBeNull();
  });
});

describe("finishResend", () => {
  it("marks a send that went out and keeps the click-time cooldown running", async () => {
    const started = aState({ cooldownEndsAt: CLICK + 60_000 });
    await expect(
      finishResend(started, () => Promise.resolve({ ok: true })),
    ).resolves.toEqual({ sent: true, failed: false, cooldownEndsAt: CLICK + 60_000 });
  });

  it("downgrades a refused send to the plain retry state", async () => {
    const started = aState({ cooldownEndsAt: CLICK + 60_000 });
    await expect(
      finishResend(started, () => Promise.resolve({ ok: false })),
    ).resolves.toEqual({ sent: false, failed: true, cooldownEndsAt: CLICK + 60_000 });
  });

  it("catches a rejected send instead of leaking an unhandled rejection", async () => {
    const started = aState({ cooldownEndsAt: CLICK + 60_000 });
    await expect(
      finishResend(started, () => Promise.reject(new Error("boom"))),
    ).resolves.toEqual({ sent: false, failed: true, cooldownEndsAt: CLICK + 60_000 });
  });
});
