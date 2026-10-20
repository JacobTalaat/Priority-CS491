import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_STRINGS = ["AI_API_KEY", "aiApiKey", "NEXT_PUBLIC_AI"];

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

describe("AI key boundary", () => {
  it("never mentions the AI key variable in app or component code", () => {
    const files = [...filesUnder("src/app"), ...filesUnder("src/components")];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_STRINGS) {
        expect(text.includes(forbidden), `${file} contains ${forbidden}`).toBe(false);
      }
    }
  });

  it("keeps src/lib/ai.ts out of client bundles with import server-only", () => {
    const text = readFileSync(join(process.cwd(), "src/lib/ai.ts"), "utf8");
    expect(text.startsWith('import "server-only";')).toBe(true);
  });

  it("keeps a NEXT_PUBLIC AI variable out of .env.example", () => {
    const text = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(text).not.toContain("NEXT_PUBLIC_AI");
  });
});
