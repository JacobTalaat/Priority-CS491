import { createHash, createHmac, hkdfSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

process.env.CANVAS_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const {
  RECOVERY_ALPHABET,
  RECOVERY_CODE_LENGTH,
  RECOVERY_CODE_COUNT,
  generateRecoveryCode,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  recoveryCodeHash,
  recoveryCodeHashFromRaw,
} = await import("./two-factor-codes");

describe("generateRecoveryCode", () => {
  it("uses the display format and only characters without look-alikes", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateRecoveryCode();
      expect(code).toMatch(/^[^-]{4}-[^-]{4}-[^-]{2}$/);
      for (const character of code.replace(/-/g, "")) {
        expect(RECOVERY_ALPHABET).toContain(character);
      }
    }
  });

  it("carries at least 50 bits of entropy", () => {
    expect(RECOVERY_ALPHABET.length).toBe(32);
    expect(RECOVERY_CODE_LENGTH).toBe(10);
    expect(Math.log2(RECOVERY_ALPHABET.length ** RECOVERY_CODE_LENGTH)).toBeGreaterThanOrEqual(50);
  });
});

describe("generateRecoveryCodes", () => {
  it("answers ten distinct codes by default", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });
});

describe("normalizeRecoveryCode", () => {
  it("accepts the code exactly as a student could type it", () => {
    expect(normalizeRecoveryCode("AbCd-EfGh-Jk")).toBe("abcdefghjk");
    expect(normalizeRecoveryCode("abcd efghjk")).toBe("abcdefghjk");
    expect(normalizeRecoveryCode("abcdefghjk")).toBe("abcdefghjk");
  });

  it("answers null for anything that is not a full code", () => {
    expect(normalizeRecoveryCode("abcd-efgh")).toBeNull();
    expect(normalizeRecoveryCode("")).toBeNull();
    // Not an alphabet character: a retype error is rejected, not stripped.
    expect(normalizeRecoveryCode("abcd-fghi0j")).toBeNull();
    expect(normalizeRecoveryCode("abcdefghjjk0")).toBeNull();
  });

  it("keeps the answer stable for spacing variants", () => {
    expect(normalizeRecoveryCode("abcd-efgh-jk ")).toBe(normalizeRecoveryCode("abcdefghjk"));
    expect(normalizeRecoveryCode("abcd efgh jk")).toBe(normalizeRecoveryCode("abcdefghjk"));
  });
});

describe("recoveryCodeHash", () => {
  // hkdfSync is deterministic, so this mirrors the key the library derives
  // from the same env key material and the same info label.
  function mirrorKey(): Buffer {
    return Buffer.from(
      hkdfSync("sha256", Buffer.alloc(32, 7), Buffer.alloc(0), "priority/recovery-codes/v1", 32)
    );
  }

  beforeAll(() => {
    expect(mirrorKey().length).toBe(32);
  });

  it("is an HMAC of the normalized code, not a plain sha256 of it", () => {
    const hash = recoveryCodeHash("abcdefghjk");
    expect(hash).toBe(createHmac("sha256", mirrorKey()).update("abcdefghjk").digest("hex"));
    expect(hash).not.toBe(createHash("sha256").update("abcdefghjk").digest("hex"));
  });

  it("hashes different codes to different hashes", () => {
    expect(recoveryCodeHash("abcdefghjk")).not.toBe(recoveryCodeHash("abcdefghjl"));
  });

  it("hashes the same code the same way on every call", () => {
    expect(recoveryCodeHash("abcdefghjk")).toBe(recoveryCodeHash("abcdefghjk"));
  });

  it("answers the same hash for every way a student may type a code", () => {
    expect(recoveryCodeHashFromRaw("ABCD-EFGH-JK")).toBe(recoveryCodeHash("abcdefghjk"));
    expect(recoveryCodeHashFromRaw("abcd efghjk")).toBe(recoveryCodeHash("abcdefghjk"));
    expect(recoveryCodeHashFromRaw("abcd-efgh-jk")).toBe(recoveryCodeHash("abcdefghjk"));
  });

  it("answers null for a malformed code so callers can refuse it", () => {
    expect(recoveryCodeHashFromRaw("short")).toBeNull();
  });
});
