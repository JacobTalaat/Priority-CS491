import { createHash } from "node:crypto";

export const MAX_FAILED_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_TRACKED_ACCOUNTS = 10_000;

type FailureWindow = { firstFailureAt: number; attempts: number };

const failures = new Map<string, FailureWindow>();

function emailKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function dropExpiredWindows(nowMs: number): void {
  for (const [key, failureWindow] of failures) {
    if (nowMs - failureWindow.firstFailureAt >= WINDOW_MS) {
      failures.delete(key);
    }
  }
}

export function checkLoginAllowed(
  email: string,
  now = new Date()
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const key = emailKey(email);
  const nowMs = now.getTime();
  const failureWindow = failures.get(key);
  if (!failureWindow) {
    if (failures.size >= MAX_TRACKED_ACCOUNTS) {
      dropExpiredWindows(nowMs);
    }
    if (failures.size >= MAX_TRACKED_ACCOUNTS) {
      return { allowed: false, retryAfterSeconds: Math.ceil(WINDOW_MS / 1000) };
    }
    return { allowed: true };
  }
  const remaining = WINDOW_MS - (nowMs - failureWindow.firstFailureAt);
  if (remaining <= 0) {
    failures.delete(key);
    return { allowed: true };
  }
  if (failureWindow.attempts < MAX_FAILED_ATTEMPTS) {
    return { allowed: true };
  }
  return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

export function recordFailedLogin(email: string, now = new Date()): void {
  const key = emailKey(email);
  const failureWindow = failures.get(key);
  if (!failureWindow || now.getTime() - failureWindow.firstFailureAt >= WINDOW_MS) {
    if (!failureWindow && failures.size >= MAX_TRACKED_ACCOUNTS) {
      return;
    }
    failures.set(key, { firstFailureAt: now.getTime(), attempts: 1 });
    return;
  }
  failureWindow.attempts += 1;
}

export function clearFailedLogins(email: string): void {
  failures.delete(emailKey(email));
}

export function resetLoginRateLimitForTests(): void {
  failures.clear();
}
