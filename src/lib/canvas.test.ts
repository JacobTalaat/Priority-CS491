import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasError, canvasFetch, normalizeCanvasBaseUrl } from "./canvas";

const BASE_URL = "https://canvas.example.edu";
const TOKEN = "canvas-token-123";
const PATH = "/api/v1/users/self/profile";

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("canvasFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps 401 to unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401)));
    const error = await canvasFetch(BASE_URL, TOKEN, PATH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanvasError);
    expect((error as CanvasError).kind).toBe("unauthorized");
    expect((error as CanvasError).message).not.toContain(TOKEN);
    expect((error as CanvasError).stack).not.toContain(TOKEN);
  });

  it("maps 403 to unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403)));
    const error = await canvasFetch(BASE_URL, TOKEN, PATH).catch((e: unknown) => e);
    expect((error as CanvasError).kind).toBe("unauthorized");
    expect((error as CanvasError).message).not.toContain(TOKEN);
  });

  it("maps 500 to http with the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500)));
    const error = await canvasFetch(BASE_URL, TOKEN, PATH).catch((e: unknown) => e);
    expect((error as CanvasError).kind).toBe("http");
    expect((error as CanvasError).status).toBe(500);
    expect((error as CanvasError).message).toContain("500");
    expect((error as CanvasError).message).not.toContain(TOKEN);
    expect((error as CanvasError).stack).not.toContain(TOKEN);
  });

  it("maps a rejected fetch to network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const error = await canvasFetch(BASE_URL, TOKEN, PATH).catch((e: unknown) => e);
    expect((error as CanvasError).kind).toBe("network");
    expect((error as CanvasError).message).not.toContain(TOKEN);
    expect((error as CanvasError).stack).not.toContain(TOKEN);
  });

  it("sends the Authorization header", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(200, { id: 1, name: "Student" }));
    vi.stubGlobal("fetch", mockFetch);
    const { data } = await canvasFetch(BASE_URL, TOKEN, PATH);
    expect(data).toEqual({ id: 1, name: "Student" });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${PATH}`);
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Accept")).toBe("application/json");
  });
});

describe("normalizeCanvasBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeCanvasBaseUrl("https://canvas.example.edu/")).toBe("https://canvas.example.edu");
    expect(normalizeCanvasBaseUrl("https://canvas.example.edu///")).toBe("https://canvas.example.edu");
  });

  it("rejects http URLs", () => {
    expect(() => normalizeCanvasBaseUrl("http://canvas.example.edu")).toThrow();
  });

  it("rejects a bare hostname", () => {
    expect(() => normalizeCanvasBaseUrl("canvas.example.edu")).toThrow();
  });

  it("rejects loopback, private, link-local and metadata hosts", () => {
    for (const url of [
      "https://127.0.0.1:8443",
      "https://localhost:9200",
      "https://[::1]",
      "https://0.0.0.0",
      "https://10.0.0.5",
      "https://172.16.5.5",
      "https://192.168.1.1",
      "https://100.64.0.1",
      "https://169.254.169.254",
      "https://239.1.1.1",
      "https://service.internal",
    ]) {
      expect(() => normalizeCanvasBaseUrl(url), url).toThrow();
    }
  });

  it("allows public Canvas hosts next to the blocked ranges", () => {
    expect(normalizeCanvasBaseUrl("https://njit.instructure.com")).toBe("https://njit.instructure.com");
    expect(normalizeCanvasBaseUrl("https://172.15.0.1")).toBe("https://172.15.0.1");
  });
});
