import { assertPublicHost, isInternalHostname } from "./public-host";

const UNAUTHORIZED_STATUSES = [401, 403];

function redirectLocationMessage(location: string | null, requestUrl: string): string {
  if (location) {
    try {
      const target = new URL(location, requestUrl);
      if (target.protocol === "https:") {
        return `Canvas redirected to ${target.origin}. Use that address instead.`;
      }
    } catch {
      // fall through to the generic message
    }
  }
  return "Canvas redirected this request; use your school's Canvas address directly.";
}

export class CanvasError extends Error {
  readonly kind: "unauthorized" | "http" | "network" | "redirect";
  readonly status?: number;

  constructor(kind: "unauthorized" | "http" | "network" | "redirect", message: string, status?: number) {
    super(message);
    this.name = "CanvasError";
    this.kind = kind;
    this.status = status;
  }
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
  const requestUrl = `${baseUrl}${path}`;
  // We look the hostname up ourselves and refuse private answers, but fetch does
  // its own DNS for the actual connection: an attacker who answers us publicly
  // and fetch privately would still get a connection (DNS rebinding). Closing
  // that gap would mean pinning the resolved IP into the connection, which needs
  // a custom dispatcher.
  try {
    await assertPublicHost(new URL(baseUrl).hostname);
  } catch {
    throw new CanvasError("network", "Canvas request failed before a response");
  }
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    // redirect: "manual" makes undici hand back the 3xx response itself instead
    // of following it, so the Location header stays readable
    if (response.status >= 300 && response.status < 400) {
      throw new CanvasError(
        "redirect",
        redirectLocationMessage(response.headers.get("location"), requestUrl),
        response.status
      );
    }
  } catch (error) {
    if (error instanceof CanvasError) {
      throw error;
    }
    throw new CanvasError("network", "Canvas request failed before a response");
  }
  if (UNAUTHORIZED_STATUSES.includes(response.status)) {
    throw new CanvasError("unauthorized", "Canvas rejected credentials", response.status);
  }
  if (!response.ok) {
    throw new CanvasError("http", `Canvas returned ${response.status}`, response.status);
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
