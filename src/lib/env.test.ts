import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

describe("readEnv", () => {
  it("throws naming DATABASE_URL when it is missing", () => {
    expect(() => readEnv({}).databaseUrl).toThrow(
      "Missing required environment variable DATABASE_URL"
    );
  });

  it("throws naming DATABASE_URL when it is empty", () => {
    expect(() => readEnv({ DATABASE_URL: "" }).databaseUrl).toThrow("DATABASE_URL");
  });

  it("throws naming CANVAS_TOKEN_ENCRYPTION_KEY when it is missing", () => {
    const source = { DATABASE_URL: "postgresql://localhost" };
    expect(() => readEnv(source).canvasTokenEncryptionKey).toThrow(
      "Missing required environment variable CANVAS_TOKEN_ENCRYPTION_KEY"
    );
  });

  it("throws when the key is valid base64 but not 32 bytes", () => {
    const source = {
      DATABASE_URL: "postgresql://localhost",
      CANVAS_TOKEN_ENCRYPTION_KEY: randomBytes(16).toString("base64"),
    };
    expect(() => readEnv(source).canvasTokenEncryptionKey).toThrow(
      "CANVAS_TOKEN_ENCRYPTION_KEY must be base64 encoding exactly 32 bytes"
    );
  });

  it("throws when the key is not base64 at all", () => {
    const source = {
      DATABASE_URL: "postgresql://localhost",
      CANVAS_TOKEN_ENCRYPTION_KEY: "not a base64 key!",
    };
    expect(() => readEnv(source).canvasTokenEncryptionKey).toThrow(
      "CANVAS_TOKEN_ENCRYPTION_KEY must be base64 encoding exactly 32 bytes"
    );
  });

  it("accepts a base64 key that decodes to exactly 32 bytes", () => {
    const source = {
      DATABASE_URL: "postgresql://localhost",
      CANVAS_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    };
    expect(readEnv(source).canvasTokenEncryptionKey).toBe(source.CANVAS_TOKEN_ENCRYPTION_KEY);
  });

  it("defaults CANVAS_BASE_URL when it is absent", () => {
    expect(readEnv({}).canvasBaseUrl).toBe("https://canvas.instructure.com");
  });

  it("strips a trailing slash from CANVAS_BASE_URL", () => {
    expect(readEnv({ CANVAS_BASE_URL: "https://canvas.example.edu/" }).canvasBaseUrl).toBe(
      "https://canvas.example.edu"
    );
  });
});
