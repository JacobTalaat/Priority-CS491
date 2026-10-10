import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockKey } = vi.hoisted(() => ({
  mockKey: { value: "key-will-be-set-in-beforeEach" },
}));

vi.mock("@/lib/env", () => ({
  env: {
    get canvasTokenEncryptionKey(): string {
      return mockKey.value;
    },
    get canvasBaseUrl(): string {
      return "https://canvas.example.edu";
    },
  },
}));

import { decryptSecret, encryptSecret } from "./secrets";

const otherKey = randomBytes(32).toString("base64");

describe("encryptSecret/decryptSecret", () => {
  beforeEach(() => {
    mockKey.value = randomBytes(32).toString("base64");
  });
  it("roundtrips a secret", () => {
    const encrypted = encryptSecret("canvas-token-123");
    expect(decryptSecret(encrypted)).toBe("canvas-token-123");
  });

  it("produces different ciphertext for the same input", () => {
    const first = encryptSecret("same-secret");
    const second = encryptSecret("same-secret");
    expect(first.iv).not.toBe(second.iv);
    expect(first.cipher).not.toBe(second.cipher);
  });

  it("throws when the tag is tampered with", () => {
    const encrypted = encryptSecret("canvas-token-123");
    expect(() =>
      decryptSecret({ ...encrypted, tag: Buffer.from(randomBytes(16)).toString("base64") })
    ).toThrow();
  });

  it("throws when the key is wrong", () => {
    const encrypted = encryptSecret("canvas-token-123");
    mockKey.value = otherKey;
    expect(() => decryptSecret(encrypted)).toThrow();
  });
});
