import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "./usage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logEvent", () => {
  it("posts the event as the web client with the app token", () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { localStorage: { getItem: () => "app-token" } });

    logEvent("sync_now");

    expect(fetchMock).toHaveBeenCalledWith("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer app-token" },
      body: JSON.stringify({ event: "sync_now", client: "web" }),
    });
  });

  it("sends nothing when logged out", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });

    logEvent("sync_now");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the request fails", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    vi.stubGlobal("window", { localStorage: { getItem: () => "app-token" } });

    expect(() => logEvent("sync_now")).not.toThrow();
  });
});
