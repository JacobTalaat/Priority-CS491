import { afterEach, afterAll, describe, expect, it, vi } from "vitest";
import { CanvasError, canvasFetch, normalizeCanvasBaseUrl } from "./canvas";
import { setDnsResolverForTests } from "./public-host";

const BASE_URL = "https://canvas.example.edu";
const TOKEN = "canvas-token-123";
const PATH = "/api/v1/users/self/profile";

afterAll(() => {
  // the vitest setup file owns the default test resolver; restore it
  setDnsResolverForTests(async () => [{ address: "93.184.216.34" }]);
});

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRedirect(status: number, location: string): Response {
  return new Response(null, { status, headers: { Location: location } });
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
    expect((error as CanvasError).message).toBe("Canvas returned 500");
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

  it.each([301, 302, 307])("refuses a %d redirect instead of following it", async (status) => {
    const mockFetch = vi.fn().mockResolvedValue(jsonRedirect(status, "https://canvas.njit.edu/login"));
    vi.stubGlobal("fetch", mockFetch);
    const error = await canvasFetch(BASE_URL, TOKEN, PATH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanvasError);
    expect((error as CanvasError).kind).toBe("redirect");
    expect((error as CanvasError).message).toBe(
      "Canvas redirected to https://canvas.njit.edu. Use that address instead.",
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("names the redirect origin from a relative Location", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRedirect(302, "/login")));
    const error = await canvasFetch(BASE_URL, TOKEN, PATH).catch((e: unknown) => e);
    expect((error as CanvasError).message).toBe(
      "Canvas redirected to https://canvas.example.edu. Use that address instead.",
    );
  });

  it("never follows a redirect to an internal address", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRedirect(302, "http://169.254.169.254/latest/meta-data")));
    const error = await canvasFetch(BASE_URL, TOKEN, PATH).catch((e: unknown) => e);
    expect((error as CanvasError).kind).toBe("redirect");
    expect((error as CanvasError).message).toBe(
      "Canvas redirected this request; use your school's Canvas address directly.",
    );
  });

  it("rejects a hostname whose DNS resolves to a private address, without ever connecting", async () => {
    // fetch would succeed: the only thing standing between us and 10.0.0.5 is the DNS check.
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(200, { id: 1 }));
    vi.stubGlobal("fetch", mockFetch);
    setDnsResolverForTests(vi.fn().mockResolvedValue([{ address: "10.0.0.5" }]));
    const error = await canvasFetch(BASE_URL, TOKEN, PATH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanvasError);
    expect((error as CanvasError).kind).toBe("network");
    expect(mockFetch).not.toHaveBeenCalled();
    setDnsResolverForTests(null);
  });

  it("asks fetch not to follow redirects, so the server never connects to the redirect target", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(200, { id: 1 }));
    vi.stubGlobal("fetch", mockFetch);
    await canvasFetch(BASE_URL, TOKEN, PATH);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("rejects an address that resolves privately at fetch time even when the stored URL passed normalize", async () => {
    setDnsResolverForTests(
      vi.fn().mockResolvedValue([{ address: "100.100.100.100" }]),
    );
    const error = await canvasFetch("https://172.15.0.1.example.edu", TOKEN, PATH).catch((e: unknown) => e);
    expect((error as CanvasError).kind).toBe("network");
    setDnsResolverForTests(null);
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
