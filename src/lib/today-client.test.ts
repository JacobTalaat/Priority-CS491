import { afterEach, describe, expect, it, vi } from "vitest";
import { getToday, markDone, undoItem } from "./today-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const requests: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return Response.json({
      generatedAt: "2026-10-29T20:00:00.000Z",
      items: [],
      hoursFilter: null,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { localStorage: { getItem: () => "app-token" } });
  return { fetchMock, requests };
}

describe("today list client", () => {
  it("requests a list trimmed to the selected hours", async () => {
    const { fetchMock, requests } = stubFetch();

    await getToday(2.5);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requests[0]).toBe("/api/today?hours=2.5");
  });

  it("requests the full ranked list when no hours are selected", async () => {
    const { fetchMock, requests } = stubFetch();

    await getToday();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requests[0]).toBe("/api/today");
  });

  it("marks done with the item position and request identity", async () => {
    const { fetchMock } = stubFetch();

    await markDone("a 1", { rank: 2, listGeneratedAt: "2026-10-29T20:00:00.000Z" }, "req-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/today/items/a%201/done",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Priority-Client": "web",
          "X-Priority-Request-Id": "req-1",
        }),
        body: JSON.stringify({ rank: 2, listGeneratedAt: "2026-10-29T20:00:00.000Z" }),
      }),
    );
  });

  it("undoes with DELETE on the item", async () => {
    const { fetchMock } = stubFetch();

    await undoItem("a1", "req-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/today/items/a1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          "X-Priority-Client": "web",
          "X-Priority-Request-Id": "req-2",
        }),
      }),
    );
  });
});
