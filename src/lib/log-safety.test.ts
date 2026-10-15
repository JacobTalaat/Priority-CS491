import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasFetch } from "./canvas";
import { fetchCalendarFeed } from "./calendar-feed";
import { fetchAllPages } from "./canvas-pagination";

const TOKEN = "SENTINEL-TOKEN-must-not-leak";
const FEED_URL = "https://canvas.example.edu/calendar?feed=SENTINEL-FEED-must-not-leak";
const GRADE_VALUE = "SENTINEL-GRADE-must-not-leak";

function thrownDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return `${error.message}\n${error.stack ?? ""}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("log safety", () => {
  it("does not expose a Canvas token in failure errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const error = await canvasFetch("https://canvas.example.edu", TOKEN, "/api/v1/profile").catch(
      (caught: unknown) => caught
    );
    expect(thrownDetails(error)).not.toContain(TOKEN);
  });

  it("does not expose a calendar feed URL in failure errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));
    const error = await fetchCalendarFeed(FEED_URL).catch((caught: unknown) => caught);
    expect(thrownDetails(error)).not.toContain("SENTINEL-FEED-must-not-leak");
  });

  it("does not expose pagination URLs or grade values in failure errors", async () => {
    const paginationUrl = `/api/v1/courses/1/submissions?grade=${GRADE_VALUE}`;
    const response = new Response(JSON.stringify({}), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        Link: `<https://outside.example.edu/next?grade=${GRADE_VALUE}>; rel="next"`,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const error = await fetchAllPages("https://canvas.example.edu", TOKEN, paginationUrl).catch(
      (caught: unknown) => caught
    );
    expect(thrownDetails(error)).not.toContain(GRADE_VALUE);
  });
});
