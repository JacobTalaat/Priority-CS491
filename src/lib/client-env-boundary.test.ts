import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

const SOURCE_FILES = filesUnder("src").filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file));
const FILE_EXISTS = new Set(SOURCE_FILES);
const CLIENT_FILE_PATTERN = /(^|\n)\s*["']use client["']/;

function importSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  const fromPattern = /(?:^|\n)\s*(?:import|export)\s+[^;]*?\bfrom\s+["']([^"']+)["']/g;
  const bareImportPattern = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [fromPattern, bareImportPattern, dynamicImportPattern]) {
    for (const match of text.matchAll(pattern)) {
      const statement = match[0].replace(/^[ \n]+/, "");
      if (/^(?:import|export)\s+type\b/.test(statement)) {
        continue;
      }
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith("@/") && !specifier.startsWith("./") && !specifier.startsWith("../")) {
    return null;
  }
  let base =
    specifier.startsWith("@/")
      ? join(process.cwd(), "src", specifier.slice(2))
      : resolve(dirname(fromFile), specifier);
  if (base.endsWith(".js")) {
    base = base.slice(0, -3);
  }
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    base,
  ];
  return candidates.find((candidate) => /\.(ts|tsx)$/.test(candidate) && FILE_EXISTS.has(candidate)) ?? null;
}

// Walks the static import graph (including dynamic import() calls) from every
// client file, recording how each reached file was pulled in so a leak can be
// reported as a readable chain.
function walkClientGraph(): {
  reachable: Map<string, string | null>;
  roots: string[];
} {
  const roots = SOURCE_FILES.filter((file) => CLIENT_FILE_PATTERN.test(readFileSync(file, "utf8")));
  const reachable = new Map<string, string | null>();
  const queue = [...roots];
  for (const root of roots) {
    reachable.set(root, null);
  }
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      const target = resolveLocalImport(file, specifier);
      if (target === null || reachable.has(target)) {
        continue;
      }
      reachable.set(target, file);
      queue.push(target);
    }
  }
  return { reachable, roots };
}

function importChain(file: string, reachable: Map<string, string | null>): string {
  const chain = [file];
  let cursor = reachable.get(file) ?? null;
  while (cursor !== null) {
    chain.unshift(cursor);
    cursor = reachable.get(cursor) ?? null;
  }
  return chain.join(" -> ");
}

function reachabilityError(file: string, what: string, reachable: Map<string, string | null>): string {
  return `a "use client" file pulls in ${what}: ${importChain(file, reachable)}`;
}

describe("client environment boundary", () => {
  it("reaches the modules it must police so it cannot pass vacuously", () => {
    const { reachable, roots } = walkClientGraph();
    expect(roots.length).toBeGreaterThan(0);
    expect(reachable.has(join(process.cwd(), "src/lib/auth-client.ts")), "auth-client reachable").toBe(true);
    expect(reachable.has(join(process.cwd(), "src/lib/public-env.ts")), "public-env reachable").toBe(true);
  });

  it("never pulls the server environment module into a client import graph", () => {
    const { reachable } = walkClientGraph();
    const envPath = join(process.cwd(), "src/lib/env.ts");
    if (reachable.has(envPath)) {
      throw new Error(`src/lib/env.ts ${reachabilityError(envPath, "src/lib/env.ts", reachable)}`);
    }
    expect(reachable.has(envPath)).toBe(false);
  });

  it("keeps server-only modules out of the client import graph", () => {
    const { reachable } = walkClientGraph();
    const offenders: string[] = [];
    for (const file of reachable.keys()) {
      const text = readFileSync(file, "utf8");
      if (/(?:^|\n)\s*import\s+["']server-only["']/.test(text)) {
        offenders.push(reachabilityError(file, 'a module containing `import "server-only"`', reachable));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads NEXT_PUBLIC variables only through literal process.env property accesses", () => {
    const { reachable } = walkClientGraph();
    const offenders: string[] = [];
    for (const file of reachable.keys()) {
      const text = readFileSync(file, "utf8");
      const destructure = /\{[^{}]*NEXT_PUBLIC_[A-Z0-9_][^{}]*\}\s*=\s*process\s*\.\s*env\b/g;
      if (destructure.test(text)) {
        offenders.push(`${file}: destructures NEXT_PUBLIC variables out of process.env`);
      }
      const bracketReceiver =
        /[\w$\]\)]\s*\[\s*["']NEXT_PUBLIC_[A-Z0-9_]+["']\s*\]/g;
      for (const match of text.matchAll(bracketReceiver)) {
        offenders.push(`${file}: bracket access ${match[0]} instead of process.env.NEXT_PUBLIC_*`);
      }
      // Every process.env read must be a member access on NEXT_PUBLIC_* or NODE_ENV;
      // copying process.env into a variable or passing it around is forbidden.
      for (const match of text.matchAll(/process\s*\.\s*env\b/g)) {
        const after = text.slice(match.index + match[0].length).replace(/^[ \t]+/, "");
        if (/^\s*\.\s*(?:NEXT_PUBLIC(?:_[A-Z0-9_]*)?|NODE_ENV)\b/.test(after)) {
          continue;
        }
        const context = text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 20);
        offenders.push(`${file}: process.env not read as process.env.NEXT_PUBLIC_* or NODE_ENV (context: ${context.replace(/\n/g, "\\n")})`);
      }
      const dotAccess = /\.NEXT_PUBLIC_[A-Z0-9_][A-Z0-9_]*/g;
      for (const match of text.matchAll(dotAccess)) {
        const before = text.slice(0, match.index).replace(/\s+$/, "");
        if (/process\s*\.\s*env$/.test(before)) {
          continue;
        }
        offenders.push(
          `${file}: NEXT_PUBLIC variable not read via process.env.NEXT_PUBLIC_* (context: ...${text.slice(
            Math.max(0, (match.index ?? 0) - 40),
            (match.index ?? 0) + match[0].length + 10
          )})`
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still keeps public-env free of Node APIs and the secret key", () => {
    const text = readFileSync(join(process.cwd(), "src/lib/public-env.ts"), "utf8");
    expect(text).not.toContain("SUPABASE_SECRET_KEY");
    expect(text).not.toContain("node:");
  });
});
