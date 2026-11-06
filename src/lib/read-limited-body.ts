// Reads a request body stream up to maxBytes and stops pulling the moment the
// limit is crossed, so an oversized chunked upload never buffers more than
// maxBytes in memory. A stream that fails mid-read is "unreadable", not a crash.
export async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<
  { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; reason: "too-large" | "unreadable" }
> {
  if (body === null) {
    return { ok: true, bytes: new Uint8Array(0) };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        // A failed cancel must not replace the too-large result.
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
