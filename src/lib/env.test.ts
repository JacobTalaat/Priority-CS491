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

describe("AI_BASE_URL", () => {
  it("throws naming AI_BASE_URL when it is missing", () => {
    expect(() => readEnv({}).aiBaseUrl).toThrow("AI_BASE_URL");
  });

  it("throws naming AI_BASE_URL when it is not a URL at all", () => {
    expect(() => readEnv({ AI_BASE_URL: "not a url" }).aiBaseUrl).toThrow(
      "AI_BASE_URL must be an https URL"
    );
  });

  it("rejects a remote http URL", () => {
    expect(() => readEnv({ AI_BASE_URL: "http://api.example.com" }).aiBaseUrl).toThrow(
      "AI_BASE_URL must be an https URL"
    );
  });

  it("rejects a scheme that is neither http nor https", () => {
    expect(() => readEnv({ AI_BASE_URL: "ftp://127.0.0.1" }).aiBaseUrl).toThrow(
      "AI_BASE_URL must be an https URL"
    );
  });

  it("rejects a URL with a query string", () => {
    expect(() => readEnv({ AI_BASE_URL: "https://api.example.com/v1?key=x" }).aiBaseUrl).toThrow(
      "AI_BASE_URL must not include a query string or fragment"
    );
  });

  it("rejects a URL with a fragment", () => {
    expect(() => readEnv({ AI_BASE_URL: "https://api.example.com/v1#top" }).aiBaseUrl).toThrow(
      "AI_BASE_URL must not include a query string or fragment"
    );
  });

  it("rejects a bare query marker that parsing would strip", () => {
    expect(() => readEnv({ AI_BASE_URL: "https://a.com/v1?" }).aiBaseUrl).toThrow(
      "AI_BASE_URL must not include a query string or fragment"
    );
  });

  it("rejects a bare fragment marker that parsing would strip", () => {
    expect(() => readEnv({ AI_BASE_URL: "https://a.com/v1#" }).aiBaseUrl).toThrow(
      "AI_BASE_URL must not include a query string or fragment"
    );
  });

  it("rejects a base URL with embedded credentials", () => {
    expect(() => readEnv({ AI_BASE_URL: "https://u:p@a.com/v1" }).aiBaseUrl).toThrow(
      "AI_BASE_URL must not include credentials"
    );
  });

  it("accepts a padded URL and returns the canonical form without padding or a trailing slash", () => {
    expect(readEnv({ AI_BASE_URL: " https://a.com/v1/ " }).aiBaseUrl).toBe("https://a.com/v1");
  });

  it("accepts an https URL with trailing slashes and strips them", () => {
    expect(readEnv({ AI_BASE_URL: "https://api.example.com/v1/" }).aiBaseUrl).toBe(
      "https://api.example.com/v1"
    );
  });

  it("accepts a local http URL and returns it without a trailing slash", () => {
    expect(readEnv({ AI_BASE_URL: "http://127.0.0.1:8787/v1/" }).aiBaseUrl).toBe(
      "http://127.0.0.1:8787/v1"
    );
    expect(readEnv({ AI_BASE_URL: "http://localhost:8787/v1" }).aiBaseUrl).toBe(
      "http://localhost:8787/v1"
    );
    expect(readEnv({ AI_BASE_URL: "http://[::1]:8787/v1" }).aiBaseUrl).toBe("http://[::1]:8787/v1");
  });
});

describe("AI_MODEL", () => {
  it("throws naming AI_MODEL when it is missing", () => {
    expect(() => readEnv({}).aiModel).toThrow("Missing required environment variable AI_MODEL");
  });

  it("throws naming AI_MODEL when it is blank", () => {
    expect(() => readEnv({ AI_MODEL: "   " }).aiModel).toThrow("AI_MODEL");
  });

  it("returns a trimmed model name", () => {
    expect(readEnv({ AI_MODEL: " model-x " }).aiModel).toBe("model-x");
  });
});

describe("AI_API_KEY", () => {
  it("throws naming only the variable when it is missing", () => {
    expect(() => readEnv({}).aiApiKey).toThrow(
      "Missing required environment variable AI_API_KEY"
    );
  });

  it("throws naming only the variable when it is blank", () => {
    const errorText = (() => {
      try {
        void readEnv({ AI_API_KEY: "   " }).aiApiKey;
        return "";
      } catch (caught) {
        return caught instanceof Error ? caught.message : String(caught);
      }
    })();
    expect(errorText).toContain("AI_API_KEY");
    expect(() => readEnv({ AI_API_KEY: "" }).aiApiKey).toThrow(
      "Missing required environment variable AI_API_KEY"
    );
  });
});

describe("Supabase variables", () => {
  it("throws naming NEXT_PUBLIC_SUPABASE_URL when it is missing", () => {
    expect(() => readEnv({}).supabaseUrl).toThrow(
      "Missing required environment variable NEXT_PUBLIC_SUPABASE_URL"
    );
  });

  it("throws naming NEXT_PUBLIC_SUPABASE_URL when it is not a URL", () => {
    expect(() => readEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" }).supabaseUrl).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL must be an https URL"
    );
  });

  it("rejects a remote http Supabase URL", () => {
    expect(() => readEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://abc123.supabase.co" }).supabaseUrl).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL must be an https URL"
    );
  });

  it("accepts a local http Supabase URL for Supabase CLI development", () => {
    expect(readEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }).supabaseUrl).toBe(
      "http://localhost:54321"
    );
  });

  it("rejects a Supabase URL with a query string, fragment, or credentials", () => {
    expect(() =>
      readEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc123.supabase.co/?key=x" }).supabaseUrl
    ).toThrow("NEXT_PUBLIC_SUPABASE_URL must not include a query string or fragment");
    expect(() => readEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc123.supabase.co/#y" }).supabaseUrl).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL must not include a query string or fragment"
    );
    expect(() => readEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://u:p@abc123.supabase.co" }).supabaseUrl).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL must not include credentials"
    );
  });

  it("strips a trailing slash from the Supabase URL", () => {
    expect(readEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc123.supabase.co/" }).supabaseUrl).toBe(
      "https://abc123.supabase.co"
    );
  });

  it("throws naming the publishable key when it is missing or blank", () => {
    expect(() => readEnv({}).supabasePublishableKey).toThrow(
      "Missing required environment variable NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
    expect(() => readEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "   " }).supabasePublishableKey).toThrow(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  });

  it("returns a trimmed publishable key", () => {
    expect(readEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_x " }).supabasePublishableKey).toBe(
      "sb_publishable_x"
    );
  });

  it("throws naming SUPABASE_SECRET_KEY when it is missing or blank", () => {
    expect(() => readEnv({}).supabaseSecretKey).toThrow(
      "Missing required environment variable SUPABASE_SECRET_KEY"
    );
    expect(() => readEnv({ SUPABASE_SECRET_KEY: "    " }).supabaseSecretKey).toThrow("SUPABASE_SECRET_KEY");
  });
});

describe("AI price and budget variables", () => {
  function setup(): Record<string, string | undefined> {
    return {
      AI_INPUT_USD_PER_MILLION_TOKENS: "0.15",
      AI_OUTPUT_USD_PER_MILLION_TOKENS: "0.6",
      AI_MONTHLY_BUDGET_USD: "2.99",
    };
  }

  it("throws naming each price variable when it is missing", () => {
    const missingInput = { ...setup(), AI_INPUT_USD_PER_MILLION_TOKENS: undefined };
    expect(() => readEnv(missingInput).aiInputMicrosPerMillion).toThrow(
      "Missing required environment variable AI_INPUT_USD_PER_MILLION_TOKENS"
    );
    const missingOutput = { ...setup(), AI_OUTPUT_USD_PER_MILLION_TOKENS: undefined };
    expect(() => readEnv(missingOutput).aiOutputMicrosPerMillion).toThrow(
      "Missing required environment variable AI_OUTPUT_USD_PER_MILLION_TOKENS"
    );
  });

  it("converts decimal dollar strings to integer micro-dollars without floats", () => {
    expect(
      readEnv({
        AI_INPUT_USD_PER_MILLION_TOKENS: "0.15",
        AI_OUTPUT_USD_PER_MILLION_TOKENS: "0",
        AI_MONTHLY_BUDGET_USD: "2.99",
      }).aiInputMicrosPerMillion
    ).toBe(150000);
    expect(
      readEnv({
        AI_INPUT_USD_PER_MILLION_TOKENS: "0",
        AI_OUTPUT_USD_PER_MILLION_TOKENS: "0",
        AI_MONTHLY_BUDGET_USD: "2.99",
      }).aiOutputMicrosPerMillion
    ).toBe(0);
    expect(readEnv(setup()).aiInputMicrosPerMillion).toBe(150000);
    expect(readEnv(setup()).aiOutputMicrosPerMillion).toBe(600000);
    expect(readEnv({ ...setup(), AI_INPUT_USD_PER_MILLION_TOKENS: "1" }).aiInputMicrosPerMillion).toBe(
      1000000
    );
  });

  it("allows a price of 0 for free models", () => {
    const zeroPrices = {
      AI_INPUT_USD_PER_MILLION_TOKENS: "0",
      AI_OUTPUT_USD_PER_MILLION_TOKENS: "0",
      AI_MONTHLY_BUDGET_USD: "2.99",
    };
    expect(readEnv(zeroPrices).aiInputMicrosPerMillion).toBe(0);
    expect(readEnv(zeroPrices).aiOutputMicrosPerMillion).toBe(0);
  });

  it("rejects malformed price strings", () => {
    for (const bad of ["-1", "1e3", "0.1234567", "abc"]) {
      expect(() => readEnv({ ...setup(), AI_INPUT_USD_PER_MILLION_TOKENS: bad }).aiInputMicrosPerMillion).toThrow(
        "AI_INPUT_USD_PER_MILLION_TOKENS"
      );
      expect(() => readEnv({ ...setup(), AI_OUTPUT_USD_PER_MILLION_TOKENS: bad }).aiOutputMicrosPerMillion).toThrow(
        "AI_OUTPUT_USD_PER_MILLION_TOKENS"
      );
    }
  });

  it("rejects a price above 1000 USD", () => {
    expect(() => readEnv({ ...setup(), AI_INPUT_USD_PER_MILLION_TOKENS: "1000.000001" }).aiInputMicrosPerMillion).toThrow(
      "AI_INPUT_USD_PER_MILLION_TOKENS must be at most 1000 USD per million tokens"
    );
  });

  it("throws naming AI_MONTHLY_BUDGET_USD when it is missing and rejects a budget of 0", () => {
    expect(() => readEnv({}).aiMonthlyBudgetMicros).toThrow(
      "Missing required environment variable AI_MONTHLY_BUDGET_USD"
    );
    expect(() => readEnv({ AI_MONTHLY_BUDGET_USD: "0" }).aiMonthlyBudgetMicros).toThrow(
      "AI_MONTHLY_BUDGET_USD must be greater than 0"
    );
  });

  it("rejects a malformed budget", () => {
    for (const bad of ["-1", "1e3", "0.1234567", "abc"]) {
      expect(() => readEnv({ AI_MONTHLY_BUDGET_USD: bad }).aiMonthlyBudgetMicros).toThrow(
        "AI_MONTHLY_BUDGET_USD"
      );
    }
  });

  it("converts the budget to integer micro-dollars", () => {
    expect(readEnv({ AI_MONTHLY_BUDGET_USD: "0.15" }).aiMonthlyBudgetMicros).toBe(150000);
  });

  it("defaults AI_TIMEOUT_MS to 60000 when it is absent", () => {
    expect(readEnv({}).aiTimeoutMs).toBe(60000);
    expect(readEnv({ AI_TIMEOUT_MS: "" }).aiTimeoutMs).toBe(60000);
  });

  it("accepts AI_TIMEOUT_MS inside the 1000..300000 range", () => {
    expect(readEnv({ AI_TIMEOUT_MS: "15000" }).aiTimeoutMs).toBe(15000);
    expect(readEnv({ AI_TIMEOUT_MS: "300000" }).aiTimeoutMs).toBe(300000);
  });

  it("rejects AI_TIMEOUT_MS outside the range or not an integer", () => {
    expect(() => readEnv({ AI_TIMEOUT_MS: "999" }).aiTimeoutMs).toThrow("AI_TIMEOUT_MS");
    expect(() => readEnv({ AI_TIMEOUT_MS: "300001" }).aiTimeoutMs).toThrow("AI_TIMEOUT_MS");
    expect(() => readEnv({ AI_TIMEOUT_MS: "1500.5" }).aiTimeoutMs).toThrow("AI_TIMEOUT_MS");
    expect(() => readEnv({ AI_TIMEOUT_MS: "1e4" }).aiTimeoutMs).toThrow("AI_TIMEOUT_MS");
    expect(() => readEnv({ AI_TIMEOUT_MS: "abc" }).aiTimeoutMs).toThrow("AI_TIMEOUT_MS");
  });
});
