const UNAUTHORIZED_STATUSES = [401, 403];

export class CanvasError extends Error {
  readonly kind: "unauthorized" | "http" | "network";
  readonly status?: number;

  constructor(kind: "unauthorized" | "http" | "network", message: string, status?: number) {
    super(message);
    this.name = "CanvasError";
    this.kind = kind;
    this.status = status;
  }
}

function isInternalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    return true;
  }
  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const [a, b] = octets.map(Number);
  if (octets.some((part) => Number(part) > 255)) {
    return true;
  }
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export function normalizeCanvasBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Invalid Canvas URL");
  }
  if (url.protocol !== "https:" || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Invalid Canvas URL");
  }
  if (isInternalHostname(url.hostname)) {
    throw new Error("Invalid Canvas URL");
  }
  return url.origin;
}

// single chokepoint for Canvas HTTP calls
export async function canvasFetch(
  baseUrl: string,
  token: string,
  path: string,
  init?: RequestInit
): Promise<{ data: unknown; response: Response }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new CanvasError("network", `Canvas request to ${path} failed before a response`);
  }
  if (UNAUTHORIZED_STATUSES.includes(response.status)) {
    throw new CanvasError("unauthorized", `Canvas rejected credentials for ${path}`, response.status);
  }
  if (!response.ok) {
    throw new CanvasError("http", `Canvas returned ${response.status} for ${path}`, response.status);
  }
  const data: unknown = await response.json();
  return { data, response };
}

export type CanvasProfile = { id: number; name: string };

export async function getCanvasProfile(baseUrl: string, token: string): Promise<CanvasProfile> {
  const { data } = await canvasFetch(baseUrl, token, "/api/v1/users/self/profile");
  const body = data as { id?: unknown; name?: unknown };
  if (typeof body?.id !== "number" || typeof body?.name !== "string") {
    throw new CanvasError("http", "Canvas returned an unexpected profile for /api/v1/users/self/profile");
  }
  return { id: body.id, name: body.name };
}
