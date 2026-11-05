import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_STRINGS = ["SUPABASE_SECRET_KEY", "supabaseSecretKey", "admin.deleteUser"];

function filesUnder(relativeDir: string): string[] {
  const absoluteDir = join(process.cwd(), relativeDir);
  const found: string[] = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const absolutePath = join(absoluteDir, entry.name);
    if (statSync(absolutePath).isDirectory()) {
      found.push(...filesUnder(join(relativeDir, entry.name)));
    } else {
      found.push(absolutePath);
    }
  }
  return found;
}

describe("Supabase secret key boundary", () => {
  it("never mentions the secret key or admin access in app or component code", () => {
    const files = [...filesUnder("src/app"), ...filesUnder("src/components")];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_STRINGS) {
        expect(text.includes(forbidden), `${file} contains ${forbidden}`).toBe(false);
      }
    }
  });

  it("keeps src/lib/supabase.ts out of client bundles with import server-only", () => {
    const text = readFileSync(join(process.cwd(), "src/lib/supabase.ts"), "utf8");
    expect(text.startsWith('import "server-only";')).toBe(true);
  });

  it("keeps every NEXT_PUBLIC variable out of the secret key in .env.example", () => {
    const text = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(text).not.toContain("NEXT_PUBLIC_SUPABASE_SECRET");
    for (const line of text.split("\n")) {
      if (line.startsWith("NEXT_PUBLIC_")) {
        expect(line, `${line} must not hold a secret key`).not.toMatch(/SECRET/);
      }
    }
  });

  it("is the only place that names the secret key variable", () => {
    const envText = readFileSync(join(process.cwd(), "src/lib/env.ts"), "utf8");
    const supabaseText = readFileSync(join(process.cwd(), "src/lib/supabase.ts"), "utf8");
    expect(envText).toContain("SUPABASE_SECRET_KEY");
    expect(supabaseText).not.toContain("SUPABASE_SECRET_KEY");
  });
});
