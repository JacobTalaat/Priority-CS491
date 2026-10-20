import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasConnection } from "../canvas-connection";
import CanvasTokenGuidePage from "./page";

describe("Canvas token guide", () => {
  it("shows concise creation and connection steps with attributed Canvas screenshots", () => {
    const html = renderToStaticMarkup(<CanvasTokenGuidePage />);

    expect(html).toContain("Open your Canvas settings");
    expect(html).toContain("Start a new access token");
    expect(html).toContain("Name, expire, and generate it");
    expect(html).toContain("Copy it into Priority");
    expect(html).toContain("Canvas access-token guide");
    expect(html).toContain('alt="Canvas global navigation with Account and Settings highlighted."');
    expect(html).toContain('alt="Canvas User Settings with Add New Access Token highlighted."');
    expect(html).toContain("Add New Access Token");
    expect(html).toContain("Keep the token private.");
  });

  it("links to the guide from the Canvas connection section", () => {
    const html = renderToStaticMarkup(<CanvasConnection />);

    expect(html).toContain('href="/settings/canvas-token-guide"');
    expect(html).toContain("Follow the step-by-step guide");
  });
});
