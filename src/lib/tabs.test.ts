import { describe, expect, it } from "vitest";
import { TABS, isTabActive } from "./tabs";

describe("TABS", () => {
  it("lists the four tabs in order", () => {
    expect(TABS.map((tab) => tab.label)).toEqual(["Today", "Classes", "Weights", "Settings"]);
  });
});

describe("isTabActive", () => {
  it("matches the exact path", () => {
    expect(isTabActive("/classes", "/classes")).toBe(true);
  });

  it("matches nested pages under the tab", () => {
    expect(isTabActive("/classes/42", "/classes")).toBe(true);
  });

  it("does not match a path that only shares a prefix", () => {
    expect(isTabActive("/classesx", "/classes")).toBe(false);
  });

  it("does not match a different tab", () => {
    expect(isTabActive("/today", "/settings")).toBe(false);
  });
});
