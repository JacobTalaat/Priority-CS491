import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllPages, parseNextLink } from "./canvas-pagination";

const BASE_URL = "https://canvas.example.edu";
const TOKEN = "canvas-token-123";
const PATH = "/api/v1/courses?per_page=100";

function jsonResponse(status: number, body: unknown, link?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(link ? { Link: link } : {}),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseNextLink", () => {
  it("finds the next URL among several rel entries", () => {
    const header = '<https://canvas.example.edu/api/v1/courses?page=1&per_page=100>; rel="current", <https://canvas.example.edu/api/v1/courses?page=2&per_page=100>; rel="next", <https://canvas.example.edu/api/v1/courses?page=5&per_page=100>; rel="last"';
    expect(parseNextLink(header)).toBe("https://canvas.example.edu/api/v1/courses?page=2&per_page=100");
  });

  it("returns null when there is no next rel", () => {
    const header = '<https://canvas.example.edu/api/v1/courses?page=1&per_page=100>; rel="current", <https://canvas.example.edu/api/v1/courses?page=1&per_page=100>; rel="last"';
    expect(parseNextLink(header)).toBeNull();
  });

  it("returns null for a null header", () => {
    expect(parseNextLink(null)).toBeNull();
  });
});

describe("fetchAllPages", () => {
  const FIRST_LINK = '<https://canvas.example.edu/api/v1/courses?page=2&per_page=100>; rel="next"';

  it("follows a two-page chain and concatenates in order", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [{ id: 1 }], FIRST_LINK))
      .mockResolvedValueOnce(jsonResponse(200, [{ id: 2 }, { id: 3 }]));
    vi.stubGlobal("fetch", mockFetch);
    await expect(fetchAllPages(BASE_URL, TOKEN, PATH)).resolves.toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [secondUrl, secondInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(secondUrl).toBe("https://canvas.example.edu/api/v1/courses?page=2&per_page=100");
    const headers = new Headers(secondInit.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("makes exactly one request when Link is absent", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(200, [{ id: 1 }]));
    vi.stubGlobal("fetch", mockFetch);
    await expect(fetchAllPages(BASE_URL, TOKEN, PATH)).resolves.toEqual([{ id: 1 }]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws once past the 50-page cap", async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(async () => jsonResponse(200, [], FIRST_LINK));
    vi.stubGlobal("fetch", mockFetch);
    const error = await fetchAllPages(BASE_URL, TOKEN, PATH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("50");
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(50);
  });
});
