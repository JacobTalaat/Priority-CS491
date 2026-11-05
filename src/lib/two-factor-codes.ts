import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// 32 symbols with the ambiguous ones left out (no i, o, 0 or 1): every code
// character carries exactly 5 bits, so "xxxx-xxxx-xx" holds 50 bits. Codes are
// always lowercase, the way an authenticator-style string types in.
export const RECOVERY_ALPHABET = "23456789abcdefghjklmnpqrstuvwxyz";
export const RECOVERY_CODE_LENGTH = 10;
export const RECOVERY_CODE_COUNT = 10;

// A 50-bit code behind a plain sha256 would fall to an offline brute force
// after a database leak, so the stored digest is an HMAC instead. The key is
// derived from the server-side Canvas encryption key (already required, never
// in the database) with a distinct info label: domain separation keeps this
// purpose's key from ever matching the AES key the Canvas ciphertexts use, and
// the raw key is never reused directly.
let derivedKey: Buffer | null = null;

function recoveryCodeKey(): Buffer {
  if (derivedKey === null) {
    const bytes = hkdfSync(
      "sha256",
      Buffer.from(env.canvasTokenEncryptionKey, "base64"),
      Buffer.alloc(0),
      "priority/recovery-codes/v1",
      32
    );
    derivedKey = Buffer.from(bytes);
  }
  return derivedKey;
}

export function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  // 256 % 32 = 0, so slicing the byte this way has no modulo bias.
  const chars = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % 32]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 10)}`;
}

// Distinct codes only: the stored hash is unique, and a collision would make
// one of the shown codes impossible to use.
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateRecoveryCode());
  }
  return [...codes];
}

// Accepts the code as the student could type it: upper or lowercase, with or
// without the dashes or spaces. Everything else is a retype error, not a
// formatting variant, so the normalized code must be exactly ten alphabet
// characters — arbitrary characters are rejected, never stripped away.
export function normalizeRecoveryCode(raw: string): string | null {
  const cleaned = raw.toLowerCase().replace(/[ -]/g, "");
  const pattern = new RegExp(`^[${RECOVERY_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`);
  if (!pattern.test(cleaned)) {
    return null;
  }
  return cleaned;
}

// HMAC over the normalized code: what is stored is useless for guessing
// without the server's key, even at 2^50 attempts.
export function recoveryCodeHash(normalizedCode: string): string {
  return createHmac("sha256", recoveryCodeKey()).update(normalizedCode).digest("hex");
}

// Only the hash is ever stored or looked up; the plaintext is discarded on the
// way through. Answers null for a malformed code so callers can refuse it.
export function recoveryCodeHashFromRaw(raw: string): string | null {
  const normalized = normalizeRecoveryCode(raw);
  return normalized ? recoveryCodeHash(normalized) : null;
}

// A code from generateRecoveryCode is already canonical: its dashes exist only
// for the student to read, and the store keeps the same digest a recovery
// claim computes from the typed-in code later.
export function generatedCodeHash(code: string): string {
  return recoveryCodeHash(code.replace(/-/g, ""));
}
