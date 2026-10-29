import { afterEach, describe, expect, it, vi } from "vitest";
import { markDone, undoItem } from "./today-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub() {
  const fetchMock = vi.fn(async () => Response.json({}, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { localStorage: { getItem: () => "app-token" } });
  return fetchMock;
}

describe("today item actions", () => {
  it("marks done with what was shown, as the web client, with a request id", async () => {
    const fetchMock = stub();
    await markDone("a 1", { rank: 2, listGeneratedAt: "2026-10-29T20:00:00.000Z" }, "req-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/today/items/a%201/done", {
      method: "POST",
      headers: {
        "X-Priority-Client": "web",
        "X-Priority-Request-Id": "req-1",
        "Content-Type": "application/json",
        Authorization: "Bearer app-token",
      },
      body: JSON.stringify({ rank: 2, listGeneratedAt: "2026-10-29T20:00:00.000Z" }),
    });
  });

  it("undoes with DELETE on the item", async () => {
    const fetchMock = stub();
    await undoItem("a1", "req-2");
    expect(fetchMock).toHaveBeenCalledWith("/api/today/items/a1", {
      method: "DELETE",
      headers: { "X-Priority-Client": "web", "X-Priority-Request-Id": "req-2", Authorization: "Bearer app-token" },
      body: undefined,
    });
  });
});
