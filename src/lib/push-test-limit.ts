export const MAX_TEST_SENDS = 3;
export const TEST_WINDOW_MS = 10 * 60 * 1000;
export const MAX_TRACKED_USERS = 10_000;

type TestWindow = { firstSendAt: number; sends: number };

const sends = new Map<string, TestWindow>();

function dropExpiredWindows(nowMs: number): void {
  for (const [key, window] of sends) {
    if (nowMs - window.firstSendAt >= TEST_WINDOW_MS) {
      sends.delete(key);
    }
  }
}

// Reserves a send in the same synchronous step it is checked for: two requests
// landing in the same tick cannot both take the last slot. Must be called with
// no await in between, and refundTestSend must be called when nothing is sent
// (for example the student had no subscriptions at all).
export function checkAndReserveTestSend(
  userId: string,
  now = new Date()
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const nowMs = now.getTime();
  const window = sends.get(userId);
  if (!window) {
    if (sends.size >= MAX_TRACKED_USERS) {
      dropExpiredWindows(nowMs);
    }
    if (sends.size >= MAX_TRACKED_USERS) {
      return { allowed: false, retryAfterSeconds: Math.ceil(TEST_WINDOW_MS / 1000) };
    }
    sends.set(userId, { firstSendAt: nowMs, sends: 1 });
    return { allowed: true };
  }
  const remaining = TEST_WINDOW_MS - (nowMs - window.firstSendAt);
  if (remaining <= 0) {
    sends.set(userId, { firstSendAt: nowMs, sends: 1 });
    return { allowed: true };
  }
  if (window.sends < MAX_TEST_SENDS) {
    window.sends += 1;
    return { allowed: true };
  }
  return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

// Gives back the slot a reservation consumed; used when the route turned out
// to have nothing to send.
export function refundTestSend(userId: string): void {
  const window = sends.get(userId);
  if (!window) {
    return;
  }
  if (window.sends <= 1) {
    sends.delete(userId);
    return;
  }
  window.sends -= 1;
}

export function resetTestSendLimitForTests(): void {
  sends.clear();
}
