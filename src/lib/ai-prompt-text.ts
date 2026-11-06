// Shared text handling for AI prompts: keep untrusted data from closing a
// delimiter, and recover JSON from a model reply wrapped in a code fence.

// Swapping angle brackets for look-alikes is one character for one character,
// so untrusted text can never close a <tag> delimiter early.
export function neutralizeDelimiters(text: string): string {
  return text.replaceAll("<", "‹").replaceAll(">", "›");
}

// Parses a model reply as JSON, falling back to the first ```/```json code
// fence when the raw text is not itself JSON. Throws when neither works.
export function parseJsonReply(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (!fence) {
      throw new Error("Model reply contained no JSON.");
    }
    return JSON.parse(fence[1]);
  }
}
