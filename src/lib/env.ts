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
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly supabaseSecretKey: string;
  readonly aiBaseUrl: string;
  readonly aiModel: string;
  readonly aiApiKey: string;
  readonly aiInputMicrosPerMillion: number;
  readonly aiOutputMicrosPerMillion: number;
  readonly aiMonthlyBudgetMicros: number;
  readonly aiTimeoutMs: number;
};

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
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
    get supabaseUrl(): string {
      const raw = requireValue("NEXT_PUBLIC_SUPABASE_URL", source.NEXT_PUBLIC_SUPABASE_URL).trim();
      if (raw.includes("?") || raw.includes("#")) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL must not include a query string or fragment");
      }
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an https URL");
      }
      const isLocal = LOCAL_AI_HOSTNAMES.has(parsed.hostname);
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an https URL");
      }
      if (parsed.username !== "" || parsed.password !== "") {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL must not include credentials");
      }
      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    },
    get supabasePublishableKey(): string {
      const value = requireValue(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ).trim();
      if (value === "") {
        throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a non-empty string");
      }
      return value;
    },
    get supabaseSecretKey(): string {
      const value = requireValue("SUPABASE_SECRET_KEY", source.SUPABASE_SECRET_KEY).trim();
      if (value === "") {
        throw new Error("SUPABASE_SECRET_KEY must be a non-empty string");
      }
      return value;
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
  };
}

export const env: Env = readEnv(process.env);
