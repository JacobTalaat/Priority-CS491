const LOCAL_SUPABASE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseSupabaseUrl(raw: string | undefined): string {
  if (!raw) {
    throw new Error("Missing required environment variable NEXT_PUBLIC_SUPABASE_URL");
  }
  const trimmed = raw.trim();
  if (trimmed.includes("?") || trimmed.includes("#")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must not include a query string or fragment");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an https URL");
  }
  const isLocal = LOCAL_SUPABASE_HOSTNAMES.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an https URL");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must not include credentials");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

export function parseSupabasePublishableKey(raw: string | undefined): string {
  if (!raw) {
    throw new Error("Missing required environment variable NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  const value = raw.trim();
  if (value === "") {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a non-empty string");
  }
  return value;
}

// The getters must read the literal process.env.NEXT_PUBLIC_* expressions:
// Next.js only inlines those into the browser bundle. Lazy getters also keep
// importing this module from throwing when the variables are absent.
export const publicEnv = {
  get supabaseUrl(): string {
    return parseSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabasePublishableKey(): string {
    return parseSupabasePublishableKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  },
};
