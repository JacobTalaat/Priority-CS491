import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, loginPathFor, safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps a path on this site, including its query", () => {
    expect(safeNextPath("/classes/42?tab=grades")).toBe("/classes/42?tab=grades");
  });

  it("uses the first value when the param is repeated", () => {
    expect(safeNextPath(["/weights", "/settings"])).toBe("/weights");
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["https://evil.example"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["javascript:alert(1)"],
    ["classes"],
  ])("falls back to Today for %j", (raw) => {
    expect(safeNextPath(raw)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("does not send a student back to the log in or sign up page", () => {
    expect(safeNextPath("/login?next=%2Ftoday")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("/signup")).toBe(DEFAULT_AFTER_LOGIN);
  });
});

describe("loginPathFor", () => {
  it("encodes the page to come back to", () => {
    expect(loginPathFor("/classes/42?tab=grades")).toBe("/login?next=%2Fclasses%2F42%3Ftab%3Dgrades");
  });

  it("round-trips through safeNextPath", () => {
    const next = new URL(loginPathFor("/weights?x=1"), "http://localhost").searchParams.get("next");
    expect(safeNextPath(next)).toBe("/weights?x=1");
  });
});
