import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicEnv", () => {
  it("reads the current NEXT_PUBLIC_SUPABASE_URL at access time, trimmed and without a trailing slash", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", " https://abc123.supabase.co/ ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", " sb_publishable_x ");
    const { publicEnv } = await import("./public-env");
    expect(publicEnv.supabaseUrl).toBe("https://abc123.supabase.co");
    expect(publicEnv.supabasePublishableKey).toBe("sb_publishable_x");
  });

  it("picks up a changed value on a later access without reimporting", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://first.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "key1");
    const { publicEnv } = await import("./public-env");
    expect(publicEnv.supabaseUrl).toBe("https://first.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://second.supabase.co");
    expect(publicEnv.supabaseUrl).toBe("https://second.supabase.co");
  });

  it("throws the missing-variable message when unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    const { publicEnv } = await import("./public-env");
    expect(() => publicEnv.supabaseUrl).toThrow(
      "Missing required environment variable NEXT_PUBLIC_SUPABASE_URL"
    );
    expect(() => publicEnv.supabasePublishableKey).toThrow(
      "Missing required environment variable NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  });

  it("rejects a URL that carries a query string", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc123.supabase.co/?key=x");
    const { publicEnv } = await import("./public-env");
    expect(() => publicEnv.supabaseUrl).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL must not include a query string or fragment"
    );
  });

  it("does not throw when the module is imported with the variables unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    const imported = await import("./public-env");
    expect(typeof imported.parseSupabaseUrl).toBe("function");
  });
});

describe("parseSiteUrl", () => {
  it("is null when unset or blank, so links fall back to the browser's address", async () => {
    const { parseSiteUrl } = await import("./public-env");
    expect(parseSiteUrl(undefined)).toBeNull();
    expect(parseSiteUrl("   ")).toBeNull();
  });

  it("keeps only the origin, so a trailing slash or path can't break the links", async () => {
    const { parseSiteUrl } = await import("./public-env");
    expect(parseSiteUrl(" https://priority.example.edu/ ")).toBe("https://priority.example.edu");
    expect(parseSiteUrl("https://priority.example.edu/app")).toBe("https://priority.example.edu");
    expect(parseSiteUrl("http://192.168.1.20:3000")).toBe("http://192.168.1.20:3000");
  });

  it("rejects anything that isn't a plain http or https address", async () => {
    const { parseSiteUrl } = await import("./public-env");
    expect(() => parseSiteUrl("priority.example.edu")).toThrow(/http or https URL/);
    expect(() => parseSiteUrl("ftp://priority.example.edu")).toThrow(/http or https URL/);
    expect(() => parseSiteUrl("https://priority.example.edu/?next=x")).toThrow(/query string/);
    expect(() => parseSiteUrl("https://user:pass@priority.example.edu")).toThrow(/credentials/);
  });

  it("reads NEXT_PUBLIC_SITE_URL at access time through publicEnv", async () => {
    const { publicEnv } = await import("./public-env");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://priority.example.edu/");
    expect(publicEnv.siteUrl).toBe("https://priority.example.edu");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(publicEnv.siteUrl).toBeNull();
    vi.unstubAllEnvs();
  });
});
