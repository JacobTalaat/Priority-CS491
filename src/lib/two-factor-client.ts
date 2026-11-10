import { apiRequest } from "./api-client";
import { browserAuthClient } from "./auth-client";
import { getToken } from "./session";

// Everything below is the browser half of two factor sign in: the Supabase
// factor lifecycle (the QR code and the six digit checks) runs against the
/// browser's own session client, and the app-side routes are reached the same
/// way every other client call is.

// After the password step, only a student with a verified factor gets an
// authenticator ask: currentLevel below aal2 with an aal2 next means the
// session is still only password-proven and Supabase is waiting for the code.
export type PendingCodeStep = { step: "code" } | { step: "none" };

export async function pendingCodeStep(): Promise<PendingCodeStep> {
  try {
    const { data, error } = await browserAuthClient().auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) {
      return { step: "none" };
    }
    if (data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
      return { step: "code" };
    }
    return { step: "none" };
  } catch {
    return { step: "none" };
  }
}

export type TotpEnrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

// Starts the enrollment: an unverified factor whose QR code and secret go to
// the student's authenticator app. It must be verified or unenrolled later —
// a stray unverified factor locks nothing but is cleaned up either way.
export async function enrollAuthenticator(): Promise<TotpEnrollment | null> {
  // Supabase refuses a second TOTP enrollment with the same (empty) friendly
  // name, so an unverified factor left behind by a crashed or abandoned setup
  // blocks every future "Turn two factor on". Clear those first, and never
  // touch verified factors — they are a working authenticator app. A failed
  // cleanup must not stop the enroll attempt from being made anyway.
  try {
    const { data } = await browserAuthClient().auth.mfa.listFactors();
    for (const factor of data?.all ?? []) {
      if (factor.factor_type === "totp" && factor.status === "unverified") {
        await browserAuthClient().auth.mfa.unenroll({ factorId: factor.id });
      }
    }
  } catch {
    // Listing failed: the enroll below still gets its attempt.
  }
  const { data, error } = await browserAuthClient().auth.mfa.enroll({
    factorType: "totp",
  });
  if (error || !data) {
    return null;
  }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

// The factor id of the student's verified authenticator app, exactly what the
// code check during a log in must be answered against.
export async function verifiedTotpFactorId(): Promise<string | null> {
  const { data, error } = await browserAuthClient().auth.mfa.listFactors();
  if (error || !data) {
    return null;
  }
  const factor = data.all.find((entry) => entry.factor_type === "totp" && entry.status === "verified");
  return factor?.id ?? null;
}

export type TotpCheck =
  | { ok: true; token: string }
  | { ok: false };

// Runs challenge + verify against one factor. On success Supabase promotes
// the session to aal2 and hands back new tokens, which the client library
// stores: the token read afterwards is the one that passes the app's gate.
export async function verifyAuthenticatorCode(factorId: string, code: string): Promise<TotpCheck> {
  try {
    const { data, error } = await browserAuthClient().auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (error || !data) {
      return { ok: false };
    }
    const { data: session } = await browserAuthClient().auth.getSession();
    const token = session?.session?.access_token;
    if (!token) {
      return { ok: false };
    }
    return { ok: true, token };
  } catch {
    return { ok: false };
  }
}

// Removes an enrollment the student never finished: nobody must be left with
// an unverified factor lying around in Settings.
export async function unenrollPendingFactor(factorId: string): Promise<void> {
  try {
    await browserAuthClient().auth.mfa.unenroll({ factorId });
  } catch {
    // There is nothing left to do about a cleanup that failed: the factor
    // stays unverified and the next verification attempt recreates the flow.
  }
}

export type TwoFactorStatus = {
  enabled: boolean;
  recoveryCodesLeft: number;
};

export function twoFactorStatus() {
  return apiRequest<TwoFactorStatus>("/api/account/two-factor/status", { token: getToken() });
}

export function enableTwoFactor(token: string | null) {
  return apiRequest<{ recoveryCodes: string[] }>("/api/account/two-factor/enable", {
    method: "POST",
    token: token ?? getToken(),
  });
}

export type RecoveryAnswer = { recovered: boolean };

export function recoverTwoFactor(code: string, token: string | null) {
  return apiRequest<RecoveryAnswer>("/api/account/two-factor/recover", {
    method: "POST",
    token: token ?? getToken(),
    body: { code },
  });
}

// The route re-checks the code against Supabase server-side, so the browser
// only needs to send it along with the session token.
export function disableTwoFactor(code: string) {
  return apiRequest<{ disabled: boolean }>("/api/account/two-factor/disable", {
    method: "POST",
    token: getToken(),
    body: { code },
  });
}
