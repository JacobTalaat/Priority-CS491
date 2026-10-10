import { CanvasError, canvasFetch } from "@/lib/canvas";

const MAX_PAGES = 50;

export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  for (const part of linkHeader.split(",")) {
    const [urlPart, ...relParts] = part.split(";");
    const url = urlPart.trim();
    let isNext = false;
    for (const relPart of relParts) {
      const match = relPart.trim().match(/^rel="?(.+?)"?$/);
      if (match && match[1].trim() === "next") {
        isNext = true;
        break;
      }
    }
    if (isNext && url.startsWith("<") && url.endsWith(">")) {
      return url.slice(1, -1);
    }
  }
  return null;
}

function nextPath(next: string, baseUrl: string): string {
  const url = new URL(next, baseUrl);
  if (url.origin !== new URL(baseUrl).origin) {
    throw new Error(`Canvas pagination next URL origin does not match baseUrl: ${url.origin}`);
  }
  return `${url.pathname}${url.search}`;
}

export async function fetchAllPages<T>(baseUrl: string, token: string, path: string): Promise<T[]> {
  const results: T[] = [];
  let next: string | null = path;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, response } = await canvasFetch(baseUrl, token, next);
    if (!Array.isArray(data)) {
      throw new CanvasError("http", `Canvas returned a non-list payload for ${next}`);
    }
    results.push(...(data as T[]));
    const link = parseNextLink(response.headers.get("Link"));
    if (!link) {
      return results;
    }
    next = nextPath(link, baseUrl);
  }
  throw new Error(`Canvas pagination exceeded the ${MAX_PAGES}-page cap for ${path}`);
}
