export const MAX_CONFIRM_ATTEMPTS = 5;
export const CONFIRM_WINDOW_MS = 15 * 60 * 1000;
export const MAX_TRACKED_ACCOUNTS = 10_000;

type AttemptWindow = { firstAttemptAt: number; attempts: number };

const attempts = new Map<string, AttemptWindow>();

function dropExpiredWindows(nowMs: number): void {
  for (const [key, window] of attempts) {
    if (nowMs - window.firstAttemptAt >= CONFIRM_WINDOW_MS) {
      attempts.delete(key);
    }
  }
}

export function checkConfirmAllowed(
  userId: string,
  now = new Date()
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const nowMs = now.getTime();
  const window = attempts.get(userId);
  if (!window) {
    if (attempts.size >= MAX_TRACKED_ACCOUNTS) {
      dropExpiredWindows(nowMs);
    }
    if (attempts.size >= MAX_TRACKED_ACCOUNTS) {
      return { allowed: false, retryAfterSeconds: Math.ceil(CONFIRM_WINDOW_MS / 1000) };
    }
    return { allowed: true };
  }
  const remaining = CONFIRM_WINDOW_MS - (nowMs - window.firstAttemptAt);
  if (remaining <= 0) {
    attempts.delete(userId);
    return { allowed: true };
  }
  if (window.attempts < MAX_CONFIRM_ATTEMPTS) {
    return { allowed: true };
  }
  return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

export function recordFailedConfirm(userId: string, now = new Date()): void {
  const window = attempts.get(userId);
  if (!window || now.getTime() - window.firstAttemptAt >= CONFIRM_WINDOW_MS) {
    if (!window && attempts.size >= MAX_TRACKED_ACCOUNTS) {
      return;
    }
    attempts.set(userId, { firstAttemptAt: now.getTime(), attempts: 1 });
    return;
  }
  window.attempts += 1;
}

export function clearFailedConfirms(userId: string): void {
  attempts.delete(userId);
}

export function resetConfirmLimitForTests(): void {
  attempts.clear();
}
