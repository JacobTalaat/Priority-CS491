import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Route = { method: string; path: string };

const apiDir = fileURLToPath(new URL(".", import.meta.url));
const docFile = fileURLToPath(new URL("../../../docs/api.md", import.meta.url));
const methods = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
const exportedMethodPattern = new RegExp(
  `export\\s+(?:async\\s+)?function\\s+(${methods})\\b`,
  "g",
);
const docHeadingPattern = new RegExp(
  `^###\\s+\`(${methods})\\s+([^\`]+)\`\\s*$`,
  "gm",
);

function routeKey(route: Route): string {
  return `${route.method} ${route.path}`;
}

function findRouteMethods(): Route[] {
  const routes: Route[] = [];
  for (const entry of readdirSync(apiDir, { recursive: true, encoding: "utf8" })) {
    const segments = entry.split(/[\\/]/);
    if (segments[segments.length - 1] !== "route.ts") continue;
    const path = `/api${segments.length > 1 ? `/${segments.slice(0, -1).join("/")}` : ""}`;
    const source = readFileSync(join(apiDir, entry), "utf8");
    for (const match of source.matchAll(exportedMethodPattern)) {
      routes.push({ method: match[1], path });
    }
  }
  return routes.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

function findDocHeadings(): Route[] {
  return [...readFileSync(docFile, "utf8").matchAll(docHeadingPattern)].map(
    (match) => ({ method: match[1], path: match[2] }),
  );
}

function findDocSections(): { route: Route; body: string }[] {
  const doc = readFileSync(docFile, "utf8");
  const headings = [...doc.matchAll(docHeadingPattern)];
  return headings.map((heading, index) => {
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? doc.length;
    return {
      route: { method: heading[1], path: heading[2] },
      body: doc.slice(bodyStart, bodyEnd),
    };
  });
}

describe("docs/api.md", () => {
  it("documents every exported method of every route file", () => {
    const routes = findRouteMethods();
    expect(routes.length).toBeGreaterThan(0);
    const documented = new Set(findDocHeadings().map(routeKey));
    const missing = routes.filter((route) => !documented.has(routeKey(route)));
    expect(missing).toEqual([]);
  });

  it("lists only routes and methods that exist in the code", () => {
    const routes = new Set(findRouteMethods().map(routeKey));
    const unknown = findDocHeadings().filter(
      (heading) => !routes.has(routeKey(heading)),
    );
    expect(unknown).toEqual([]);
  });

  it("gives every documented route a request, a response, and a JSON example", () => {
    const sections = findDocSections();
    expect(sections.length).toBeGreaterThan(0);
    const required = ["**Method**", "**Path**", "**Request**", "**Response**", "```json"];
    const problems: string[] = [];
    for (const { route, body } of sections) {
      for (const part of required) {
        if (!body.includes(part)) {
          problems.push(`${routeKey(route)} is missing ${part}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
