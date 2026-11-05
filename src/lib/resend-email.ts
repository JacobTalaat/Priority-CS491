import { useCallback, useEffect, useState } from "react";
import { resendConfirmation } from "@/lib/auth-client";

// Supabase rate-limits resend, so after every send the button locks for a
// minute before it can go again.
export const RESEND_COOLDOWN_SECONDS = 60;

export type ResendState = {
  sent: boolean;
  failed: boolean;
  // Wall-clock deadline of the current cooldown, so the countdown stays honest
  // no matter when the component happens to tick.
  cooldownEndsAt: number;
};

export const INITIAL_RESEND_STATE: ResendState = { sent: false, failed: false, cooldownEndsAt: 0 };

// How long the button stays locked, counted up to the second.
export function secondsLeftAt(deadlineMs: number, nowMs: number): number {
  if (deadlineMs <= nowMs) {
    return 0;
  }
  return Math.ceil((deadlineMs - nowMs) / 1000);
}

// "Send it again" -> "Send it again (42s)" while the countdown is showing.
export function resendLabel(base: string, secondsLeft: number): string {
  return secondsLeft > 0 ? `${base} (${secondsLeft}s)` : base;
}

// The click itself starts the cooldown: even before the request resolves the
// button is locked, so repeated clicks cannot send concurrently. Returns null
// when there is no address to send to or a cooldown is still running.
export function beginResend(
  current: ResendState,
  email: string | null,
  now: number,
): ResendState | null {
  const address = email?.trim();
  if (!address || secondsLeftAt(current.cooldownEndsAt, now) > 0) {
    return null;
  }
  return { sent: false, failed: false, cooldownEndsAt: now + RESEND_COOLDOWN_SECONDS * 1000 };
}

// Waits for the send to finish. A refused answer or a rejected promise both
// end in the plain retry state instead of an unhandled rejection — the only
// difference is what the notice says.
export async function finishResend(
  started: ResendState,
  send: () => Promise<{ ok: boolean }>,
): Promise<ResendState> {
  let ok = false;
  try {
    ok = (await send()).ok;
  } catch {
    ok = false;
  }
  return { ...started, sent: ok, failed: !ok };
}

// The one state machine behind every resend button (check-your-email screen,
// confirmation-link page, log in form): lock at click, show a neutral
// confirmation or a plain retry message, hold the button while it cools down.
export function useResendConfirmation(email: string | null) {
  const [state, setState] = useState<ResendState>(INITIAL_RESEND_STATE);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const secondsLeft = secondsLeftAt(state.cooldownEndsAt, nowMs);
  const cooling = nowMs < state.cooldownEndsAt;

  useEffect(() => {
    if (!cooling) {
      return;
    }
    // The countdown label only moves if the component re-renders about once a
    // second; the deadline math stays accurate whether or not it does.
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  const resend = useCallback(async () => {
    if (!email) {
      return;
    }
    const started = beginResend(state, email, Date.now());
    if (!started) {
      return;
    }
    setState(started);
    setState(await finishResend(started, () => resendConfirmation(email)));
  }, [email, state]);

  return { sent: state.sent, failed: state.failed, secondsLeft, resend };
}
