import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/today" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

const { TabNav } = await import("./tab-nav");

function activeLinks(html: string) {
  return [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
}

describe("TabNav", () => {
  it("renders a link for each tab", () => {
    const html = renderToStaticMarkup(<TabNav />);
    for (const href of ["/today", "/classes", "/weights", "/settings"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("marks only the current tab as the active page", () => {
    pathname.current = "/weights";
    expect(activeLinks(renderToStaticMarkup(<TabNav />))).toEqual(["Weights"]);
  });

  it("keeps the parent tab active on nested pages", () => {
    pathname.current = "/classes/42";
    expect(activeLinks(renderToStaticMarkup(<TabNav />))).toEqual(["Classes"]);
  });
});
