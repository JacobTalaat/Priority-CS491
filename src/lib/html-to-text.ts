// Canvas assignment descriptions arrive as HTML. The AI plan prompt and the app
// only need readable text, so tags are dropped and the common entities decoded.
// The result is still untrusted text: whoever puts it in a prompt must keep it
// from closing their data delimiter.

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export const HTML_TO_TEXT_MAX_CHARS = 4000;

// Curly quotes and dashes arrive as numeric entities (&#8217;, &#x2019;). An
// out-of-range number is left as written rather than throwing.
function fromCodePoint(code: number, original: string): string {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : original;
}

export function htmlToText(html: unknown): string | null {
  if (typeof html !== "string") {
    return null;
  }
  // Comments, CDATA, and script and style bodies would survive tag stripping as
  // junk text (a ">" inside a comment would even end it early), so drop them
  // whole first.
  const withoutBodies = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  // A quoted attribute value may contain ">", so a tag runs to the first ">"
  // outside quotes, not the first ">" at all.
  const withoutTags = withoutBodies.replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " ");
  const withoutEntities = withoutTags
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity])
    .replace(/&#(\d{1,7});/g, (entity, code: string) => fromCodePoint(Number(code), entity))
    .replace(/&#x([0-9a-f]{1,6});/gi, (entity, code: string) => fromCodePoint(parseInt(code, 16), entity));
  const collapsed = withoutEntities.replace(/\s+/g, " ").trim();
  return collapsed.length > HTML_TO_TEXT_MAX_CHARS
    ? collapsed.slice(0, HTML_TO_TEXT_MAX_CHARS)
    : collapsed || null;
}
