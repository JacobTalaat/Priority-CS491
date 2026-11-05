import { beforeEach, describe, expect, it, vi } from "vitest";

// The guard is evaluated by the service worker through importScripts, and by this
// suite through CommonJS interop. One of the two files owns the rule; defining it
// twice would let them drift.
const pushUrlTarget = (await vi.importActual("../../public/push-guard.js")) as {
  pushUrlTarget: (rawUrl: unknown, origin: string) => string | null;
};

const ORIGIN = "https://priority.example.edu";

function target(rawUrl: unknown, origin = ORIGIN): string | null {
  return pushUrlTarget.pushUrlTarget(rawUrl, origin);
}

describe("pushUrlTarget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a same-origin path", () => {
    expect(target("/today")).toBe("/today");
  });

  it("keeps query strings and fragments on the way through", () => {
    expect(target("/classes?id=5#heading")).toBe("/classes?id=5#heading");
  });

  it("accepts an absolute same-origin URL", () => {
    expect(target("https://priority.example.edu/classes")).toBe("/classes");
  });

  it("returns null for another site's URL", () => {
    expect(target("https://evil.example.edu/today")).toBeNull();
    expect(target("//evil.example.edu/today")).toBeNull();
  });

  it("returns null when the path crosses origins via a relative scheme-less URL", () => {
    expect(target("//evil.example.edu/today", "http://priority.example.edu")).toBeNull();
  });

  it("returns null for schemes that are not http(s)", () => {
    expect(target("javascript:alert(1)")).toBeNull();
    expect(target("data:text/html,hi")).toBeNull();
    expect(target("mailto:attacker@example.com")).toBeNull();
  });

  it("returns null for anything that is not a URL at all", () => {
    expect(target(null)).toBeNull();
    expect(target(undefined)).toBeNull();
    expect(target(42)).toBeNull();
    expect(target({ url: "/today" })).toBeNull();
    expect(target("http://")).toBeNull();
  });
});
