import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToday } from "./today-client";

describe("getToday", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "session-token" } });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ generatedAt: "2026-11-07T22:00:00.000Z", items: [], hoursFilter: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  it("requests a list trimmed to the selected hours", async () => {
    await getToday(2.5);

    expect(fetch).toHaveBeenCalledWith(
      "/api/today?hours=2.5",
      expect.objectContaining({ headers: { Authorization: "Bearer session-token" } }),
    );
  });

  it("requests the full ranked list when no hours are selected", async () => {
    await getToday();

    expect(fetch).toHaveBeenCalledWith(
      "/api/today",
      expect.objectContaining({ headers: { Authorization: "Bearer session-token" } }),
    );
  });
});
