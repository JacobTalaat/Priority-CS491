import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR, apiRequest } from "./api-client";

function mockFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("sends JSON bodies and the bearer token", async () => {
    const fetchMock = mockFetch(Response.json({ ok: true }));

    await apiRequest("/api/thing", { method: "POST", body: { a: 1 }, token: "tok" });

    expect(fetchMock).toHaveBeenCalledWith("/api/thing", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
      body: JSON.stringify({ a: 1 }),
    });
  });

  it("sends a plain GET with no headers by default", async () => {
    const fetchMock = mockFetch(Response.json({}));

    await apiRequest("/api/thing");

    expect(fetchMock).toHaveBeenCalledWith("/api/thing", { method: "GET", headers: {}, body: undefined });
  });

  it("returns data on success", async () => {
    mockFetch(Response.json({ id: 1 }, { status: 201 }));
    expect(await apiRequest("/api/thing")).toEqual({ ok: true, status: 201, data: { id: 1 } });
  });

  it("returns the API's error message on failure", async () => {
    mockFetch(Response.json({ error: "Email already registered" }, { status: 409 }));
    expect(await apiRequest("/api/thing")).toEqual({
      ok: false,
      status: 409,
      error: "Email already registered",
    });
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    mockFetch(new Response("<html>oops</html>", { status: 502 }));
    expect(await apiRequest("/api/thing")).toEqual({
      ok: false,
      status: 502,
      error: "Something went wrong (502). Try again.",
    });
  });

  it("reports network failures as status 0 instead of throwing", async () => {
    mockFetch(new TypeError("Failed to fetch"));
    expect(await apiRequest("/api/thing")).toEqual({ ok: false, status: 0, error: NETWORK_ERROR });
  });
});
