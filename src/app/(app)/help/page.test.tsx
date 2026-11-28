import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HelpPage from "./page";

describe("Help page", () => {
  it("explains ranking, supported grade calculations, and Canvas token setup", () => {
    const html = renderToStaticMarkup(<HelpPage />);

    expect(html).toContain("How the ranking works");
    expect(html).toContain("graded points are calculated within each category");
    expect(html).toContain("Points-based");
    expect(html).toContain("dropping the lowest score");
    expect(html).toContain("Get a Canvas access token");
    expect(html).toContain("Copy it immediately");
    expect(html).toContain('href="/settings/canvas-token-guide"');
  });

  it("links to grade setup and Canvas settings", () => {
    const html = renderToStaticMarkup(<HelpPage />);

    expect(html).toContain('href="/weights"');
    expect(html).toContain('href="/settings"');
  });
});
