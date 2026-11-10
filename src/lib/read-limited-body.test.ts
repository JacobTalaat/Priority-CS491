import { describe, expect, it } from "vitest";
import { readBodyWithLimit } from "./read-limited-body";

function pullCountingStream(chunks: Uint8Array[]): {
  stream: ReadableStream<Uint8Array>;
  pulls: () => number;
  cancelled: () => boolean;
} {
  let pulls = 0;
  let index = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index += 1;
      } else {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, pulls: () => pulls, cancelled: () => cancelled };
}

describe("readBodyWithLimit", () => {
  it("returns the exact bytes when the body is under the limit", async () => {
    const { stream } = pullCountingStream([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    const result = await readBodyWithLimit(stream, 100);
    expect(result).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3, 4, 5]) });
  });

  it("accepts a body of exactly maxBytes", async () => {
    const { stream } = pullCountingStream([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
    const result = await readBodyWithLimit(stream, 4);
    expect(result).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3, 4]) });
  });

  it("reports too-large one byte over the limit and stops pulling", async () => {
    const tenChunks = Array.from({ length: 10 }, () => new Uint8Array(1));
    const { stream, pulls, cancelled } = pullCountingStream(tenChunks);
    const result = await readBodyWithLimit(stream, 1);
    expect(result).toEqual({ ok: false, reason: "too-large" });
    // A prefetched chunk plus the over-limit one is the most it can have pulled;
    // ten would mean the whole body was read into memory.
    expect(pulls()).toBeLessThanOrEqual(3);
    expect(cancelled()).toBe(true);
  });

  it("reports too-large when a single first chunk already exceeds the limit", async () => {
    const { stream, pulls, cancelled } = pullCountingStream([new Uint8Array(50)]);
    const result = await readBodyWithLimit(stream, 10);
    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect(pulls()).toBe(1);
    expect(cancelled()).toBe(true);
  });

  it("reports an erroring stream as unreadable", async () => {
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!pulled) {
          pulled = true;
          controller.enqueue(new Uint8Array([1, 2, 3]));
          return;
        }
        controller.error(new Error("bad transfer encoding"));
      },
    });
    await expect(readBodyWithLimit(stream, 100)).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("still returns too-large when cancelling the stream rejects", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        throw new Error("cancel failed");
      },
    });
    await expect(readBodyWithLimit(stream, 5)).resolves.toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("treats a null body as an empty body", async () => {
    const result = await readBodyWithLimit(null, 100);
    expect(result).toEqual({ ok: true, bytes: new Uint8Array(0) });
  });
});
