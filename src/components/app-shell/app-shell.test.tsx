import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ replace: vi.fn() }),
}));

import { AppShell } from "./app-shell";

describe("AppShell keyboard navigation", () => {
  it("provides a skip link to the main content", () => {
    const html = renderToStaticMarkup(<AppShell><h1>Today</h1></AppShell>);
    expect(html).toMatch(/<a class="skipLink" href="#main-content">Skip to main content<\/a>/);
    expect(html).toMatch(/<main id="main-content"[^>]*tabindex="-1"/);
  });

  it("keeps the mobile visual header order in DOM tab order", () => {
    const html = renderToStaticMarkup(<AppShell><h1>Today</h1></AppShell>);
    expect(html.indexOf("Priority home")).toBeLessThan(html.indexOf("Log out"));
    expect(html.indexOf("Log out")).toBeLessThan(html.indexOf('aria-label="Main"'));
    expect(html.indexOf('aria-label="Main"')).toBeLessThan(html.indexOf('<main id="main-content"'));
  });
});
