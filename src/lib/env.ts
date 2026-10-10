const DEFAULT_CANVAS_BASE_URL = "https://canvas.instructure.com";

export type Env = {
  readonly databaseUrl: string;
  readonly canvasTokenEncryptionKey: string;
  readonly canvasBaseUrl: string;
};

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export type EnvSource = Record<string, string | undefined>;

export function readEnv(source: EnvSource): Env {
  return {
    get databaseUrl(): string {
      return requireValue("DATABASE_URL", source.DATABASE_URL);
    },
    get canvasTokenEncryptionKey(): string {
      const value = requireValue("CANVAS_TOKEN_ENCRYPTION_KEY", source.CANVAS_TOKEN_ENCRYPTION_KEY);
      const decoded = Buffer.from(value, "base64");
      if (decoded.toString("base64") !== value || decoded.length !== 32) {
        throw new Error("CANVAS_TOKEN_ENCRYPTION_KEY must be base64 encoding exactly 32 bytes");
      }
      return value;
    },
    get canvasBaseUrl(): string {
      const value = source.CANVAS_BASE_URL;
      if (!value) {
        return DEFAULT_CANVAS_BASE_URL;
      }
      return value.replace(/\/+$/, "");
    },
  };
}

export const env: Env = readEnv(process.env);
