import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const IV_BYTES = 12;

function encryptionKey(): Buffer {
  return Buffer.from(env.canvasTokenEncryptionKey, "base64");
}

export function encryptSecret(plain: string): { cipher: string; iv: string; tag: string } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    cipher: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(parts: { cipher: string; iv: string; tag: string }): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parts.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts.cipher, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
