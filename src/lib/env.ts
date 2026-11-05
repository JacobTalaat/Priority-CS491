import { createECDH } from "node:crypto";

const DEFAULT_CANVAS_BASE_URL = "https://canvas.instructure.com";
const DEFAULT_AI_TIMEOUT_MS = 60000;
const MICRO_DECIMAL_PATTERN = /^\d+(\.\d{1,6})?$/;
const MICROS_PER_DOLLAR = BigInt(1000000);
const MAX_PRICE_MICROS = BigInt(1000) * MICROS_PER_DOLLAR;
const LOCAL_AI_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type Env = {
  readonly databaseUrl: string;
  readonly canvasTokenEncryptionKey: string;
  readonly canvasBaseUrl: string;
  readonly aiBaseUrl: string;
  readonly aiModel: string;
  readonly aiApiKey: string;
  readonly aiInputMicrosPerMillion: number;
  readonly aiOutputMicrosPerMillion: number;
  readonly aiMonthlyBudgetMicros: number;
  readonly aiTimeoutMs: number;
  readonly vapidPublicKey: string;
  readonly vapidPrivateKey: string;
  readonly vapidSubject: string;
  readonly cronSecret: string;
};

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

// Key material is formatted exactly as `npx web-push generate-vapid-keys`
// prints it: base64url (RFC 4648, no padding).
function requireVapidBytes(name: string, bytes: number, value: string | undefined): Buffer {
  const raw = requireValue(name, value).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error(`${name} must be base64url encoding exactly ${bytes} bytes`);
  }
  const decoded = Buffer.from(raw, "base64url");
  if (decoded.length !== bytes) {
    throw new Error(`${name} must be base64url encoding exactly ${bytes} bytes`);
  }
  if (bytes === 65 && decoded[0] !== 0x04) {
    throw new Error(`${name} must be an uncompressed public point (first byte 0x04)`);
  }
  return decoded;
}

function decimalToMicros(value: string): bigint {
  const [wholePart, fractionPart = ""] = value.split(".");
  const fractionMicros = `${fractionPart}000000`.slice(0, 6);
  return BigInt(wholePart) * MICROS_PER_DOLLAR + BigInt(fractionMicros);
}

function requirePriceMicros(name: string, value: string | undefined): number {
  const raw = requireValue(name, value).trim();
  if (!MICRO_DECIMAL_PATTERN.test(raw)) {
    throw new Error(`${name} must be a decimal number with at most 6 decimal places`);
  }
  const micros = decimalToMicros(raw);
  if (micros > MAX_PRICE_MICROS) {
    throw new Error(`${name} must be at most 1000 USD per million tokens`);
  }
  return Number(micros);
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
    get aiBaseUrl(): string {
      const raw = requireValue("AI_BASE_URL", source.AI_BASE_URL);
      if (raw.includes("?") || raw.includes("#")) {
        throw new Error("AI_BASE_URL must not include a query string or fragment");
      }
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        throw new Error("AI_BASE_URL must be an https URL");
      }
      const isLocal = LOCAL_AI_HOSTNAMES.has(parsed.hostname);
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
        throw new Error("AI_BASE_URL must be an https URL");
      }
      if (parsed.username !== "" || parsed.password !== "") {
        throw new Error("AI_BASE_URL must not include credentials");
      }
      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    },
    get aiModel(): string {
      const value = requireValue("AI_MODEL", source.AI_MODEL).trim();
      if (value === "") {
        throw new Error("AI_MODEL must be a non-empty string");
      }
      return value;
    },
    get aiApiKey(): string {
      const value = requireValue("AI_API_KEY", source.AI_API_KEY).trim();
      if (value === "") {
        throw new Error("AI_API_KEY must be a non-empty string");
      }
      return value;
    },
    get aiInputMicrosPerMillion(): number {
      return requirePriceMicros("AI_INPUT_USD_PER_MILLION_TOKENS", source.AI_INPUT_USD_PER_MILLION_TOKENS);
    },
    get aiOutputMicrosPerMillion(): number {
      return requirePriceMicros("AI_OUTPUT_USD_PER_MILLION_TOKENS", source.AI_OUTPUT_USD_PER_MILLION_TOKENS);
    },
    get aiMonthlyBudgetMicros(): number {
      const raw = requireValue("AI_MONTHLY_BUDGET_USD", source.AI_MONTHLY_BUDGET_USD).trim();
      if (!MICRO_DECIMAL_PATTERN.test(raw)) {
        throw new Error("AI_MONTHLY_BUDGET_USD must be a decimal number with at most 6 decimal places");
      }
      const micros = decimalToMicros(raw);
      if (micros <= BigInt(0)) {
        throw new Error("AI_MONTHLY_BUDGET_USD must be greater than 0");
      }
      return Number(micros);
    },
    get vapidPublicKey(): string {
      // An uncompressed P-256 point: 65 bytes, the format web-push checks too.
      return requireVapidBytes("VAPID_PUBLIC_KEY", 65, source.VAPID_PUBLIC_KEY).toString("base64url");
    },
    get vapidPrivateKey(): string {
      const decodedPublic = requireVapidBytes("VAPID_PUBLIC_KEY", 65, source.VAPID_PUBLIC_KEY);
      const decodedPrivate = requireVapidBytes("VAPID_PRIVATE_KEY", 32, source.VAPID_PRIVATE_KEY);
      // The key pair is used as one: the browser subscribes against the public
      // key and every send is signed with the private one. They must belong to
      // each other or the browser's subscription would be signed by a nobody.
      const ecdh = createECDH("prime256v1");
      try {
        ecdh.setPrivateKey(decodedPrivate);
      } catch {
        throw new Error("VAPID_PRIVATE_KEY must be a valid P-256 private key");
      }
      if (ecdh.getPublicKey("base64url") !== decodedPublic.toString("base64url")) {
        throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do not form a key pair. Generate them together with npx web-push generate-vapid-keys.");
      }
      return decodedPrivate.toString("base64url");
    },
    get vapidSubject(): string {
      const value = requireValue("VAPID_SUBJECT", source.VAPID_SUBJECT).trim();
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error("VAPID_SUBJECT must be a mailto: or https: URL");
      }
      if (parsed.protocol !== "mailto:" && parsed.protocol !== "https:") {
        throw new Error("VAPID_SUBJECT must be a mailto: or https: URL");
      }
      return value;
    },
    get aiTimeoutMs(): number {
      const raw = source.AI_TIMEOUT_MS;
      if (raw === undefined || raw.trim() === "") {
        return DEFAULT_AI_TIMEOUT_MS;
      }
      const trimmed = raw.trim();
      if (!/^\d+$/.test(trimmed)) {
        throw new Error("AI_TIMEOUT_MS must be an integer between 1000 and 300000");
      }
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 300000) {
        throw new Error("AI_TIMEOUT_MS must be an integer between 1000 and 300000");
      }
      return parsed;
    },
    get cronSecret(): string {
      const value = requireValue("CRON_SECRET", source.CRON_SECRET).trim();
      if (value.length < 32) {
        throw new Error("CRON_SECRET must be at least 32 characters");
      }
      return value;
    },
  };
}

export const env: Env = readEnv(process.env);
