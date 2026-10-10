export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

export const NETWORK_ERROR = "Can't reach Priority right now. Check your connection and try again.";

// Calls our own API and never throws: network failures come back as status 0.
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) {
    return { ok: true, status: response.status, data: payload as T };
  }
  const message =
    typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Something went wrong (${response.status}). Try again.`;
  return { ok: false, status: response.status, error: message };
}
