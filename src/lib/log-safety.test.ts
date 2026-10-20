import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasFetch } from "./canvas";
import { fetchCalendarFeed } from "./calendar-feed";
import { fetchAllPages } from "./canvas-pagination";
import { AiError, completeChat, type AiRequest } from "./ai";

const TOKEN = "SENTINEL-TOKEN-must-not-leak";
const FEED_URL = "https://canvas.example.edu/calendar?feed=SENTINEL-FEED-must-not-leak";
const GRADE_VALUE = "SENTINEL-GRADE-must-not-leak";
const AI_KEY = "SENTINEL-AI-KEY-must-not-leak";
const AI_PROMPT = "SENTINEL-AI-PROMPT-must-not-leak";
const PROVIDER_BODY = "SENTINEL-PROVIDER-BODY-must-not-leak";

const { mockExecuteRaw, mockQueryRaw } = vi.hoisted(() => ({
  mockExecuteRaw: vi.fn(),
  mockQueryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mockQueryRaw, $executeRaw: mockExecuteRaw },
}));

function thrownDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return `${error.message}\n${error.stack ?? ""}`;
}

function aiRequest(): AiRequest {
  return {
    feature: "test",
    messages: [{ role: "user", content: AI_PROMPT }],
    maxOutputTokens: 200,
  };
}

beforeEach(() => {
  mockQueryRaw.mockReset();
  mockExecuteRaw.mockReset();
  vi.stubEnv("AI_BASE_URL", "https://ai.example.com/v1");
  vi.stubEnv("AI_MODEL", "test-model");
  vi.stubEnv("AI_API_KEY", AI_KEY);
  vi.stubEnv("AI_INPUT_USD_PER_MILLION_TOKENS", "1");
  vi.stubEnv("AI_OUTPUT_USD_PER_MILLION_TOKENS", "1");
  vi.stubEnv("AI_MONTHLY_BUDGET_USD", "100");
  mockQueryRaw.mockResolvedValue([{ period: "2026-11" }]);
  mockExecuteRaw.mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("log safety", () => {
  it("does not expose a Canvas token in failure errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const error = await canvasFetch("https://canvas.example.edu", TOKEN, "/api/v1/profile").catch(
      (caught: unknown) => caught
    );
    expect(thrownDetails(error)).not.toContain(TOKEN);
  });

  it("does not expose a calendar feed URL in failure errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));
    const error = await fetchCalendarFeed(FEED_URL).catch((caught: unknown) => caught);
    expect(thrownDetails(error)).not.toContain("SENTINEL-FEED-must-not-leak");
  });

  it("does not expose pagination URLs or grade values in failure errors", async () => {
    const paginationUrl = `/api/v1/courses/1/submissions?grade=${GRADE_VALUE}`;
    const response = new Response(JSON.stringify({}), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        Link: `<https://outside.example.edu/next?grade=${GRADE_VALUE}>; rel="next"`,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const error = await fetchAllPages("https://canvas.example.edu", TOKEN, paginationUrl).catch(
      (caught: unknown) => caught
    );
    expect(thrownDetails(error)).not.toContain(GRADE_VALUE);
  });

  it("does not expose the AI key, prompt or provider body on a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: PROVIDER_BODY } }), { status: 401 })
      )
    );
    const error = await completeChat(aiRequest()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiError);
    const text = thrownDetails(error);
    expect(text).not.toContain(AI_KEY);
    expect(text).not.toContain(AI_PROMPT);
    expect(text).not.toContain(PROVIDER_BODY);
  });

  it("does not expose the AI key, prompt or provider body on a 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: PROVIDER_BODY } }), { status: 500 })
      )
    );
    const error = await completeChat(aiRequest()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiError);
    const text = thrownDetails(error);
    expect(text).not.toContain(AI_KEY);
    expect(text).not.toContain(AI_PROMPT);
    expect(text).not.toContain(PROVIDER_BODY);
  });

  it("does not expose the AI key or prompt on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`fetch failed with ${PROVIDER_BODY} ${AI_KEY}`))
    );
    const error = await completeChat(aiRequest()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiError);
    expect(thrownDetails(error)).not.toContain(AI_KEY);
    expect(thrownDetails(error)).not.toContain(AI_PROMPT);
    expect(thrownDetails(error)).not.toContain(PROVIDER_BODY);
  });
});
