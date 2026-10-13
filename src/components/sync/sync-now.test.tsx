import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyncNow } from "./sync-now";

describe("SyncNow", () => {
  it("renders an enabled Sync now button and a last synced label", () => {
    const html = renderToStaticMarkup(<SyncNow />);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Sync now<\/button>/);
    expect(html).not.toContain("disabled");
    expect(html).toContain("Last synced");
  });
});
