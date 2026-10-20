import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError, completeChat, type AiRequest } from "./ai";
import { costMicros, estimateInputTokens, spendPeriod } from "./ai-spend";

const { mockExecuteRaw, mockQueryRaw } = vi.hoisted(() => ({
  mockExecuteRaw: vi.fn(),
  mockQueryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mockQueryRaw, $executeRaw: mockExecuteRaw },
}));

const MESSAGES = [{ role: "user" as const, content: "hello" }];
const MAX_OUTPUT_TOKENS = 200;
const INPUT_PRICE = 1000000;
const OUTPUT_PRICE = 1000000;
let period: string;
const RESERVE = costMicros(
  estimateInputTokens(MESSAGES),
  MAX_OUTPUT_TOKENS,
  INPUT_PRICE,
  OUTPUT_PRICE
);
const MODEL = "test-model";
const API_KEY = "TEST-SENTINEL-AI-KEY";

function aiResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const init = call?.[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

function requestInit(): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return call?.[1] as unknown as Record<string, unknown>;
}

const fetchMock = vi.fn();

function baseRequest(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    feature: "test",
    messages: MESSAGES.map((message) => ({ ...message })),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    ...overrides,
  };
}

function captureError(run: () => Promise<unknown>): Promise<unknown> {
  return run().catch((caught: unknown) => caught);
}

beforeEach(() => {
  period = spendPeriod(new Date());
  mockQueryRaw.mockReset();
  mockExecuteRaw.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AI_BASE_URL", "https://ai.example.com/v1");
  vi.stubEnv("AI_MODEL", MODEL);
  vi.stubEnv("AI_API_KEY", API_KEY);
  vi.stubEnv("AI_INPUT_USD_PER_MILLION_TOKENS", "1");
  vi.stubEnv("AI_OUTPUT_USD_PER_MILLION_TOKENS", "1");
  vi.stubEnv("AI_MONTHLY_BUDGET_USD", "100");
  mockQueryRaw.mockResolvedValue([{ period }]);
  mockExecuteRaw.mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("completeChat", () => {
  it("sends the request to AI_BASE_URL/chat/completions with the model, key and max_tokens", async () => {
    fetchMock.mockResolvedValue(
      aiResponse({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })
    );
    const completion = await completeChat(baseRequest());
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://ai.example.com/v1/chat/completions");
    const init = requestInit();
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    });
    expect(requestBody()).toMatchObject({
      model: MODEL,
      messages: MESSAGES,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: false,
    });
    expect(completion).toMatchObject({ model: MODEL, text: "hi", finishReason: "stop" });
  });

  it("follows changes to AI_BASE_URL, AI_MODEL and AI_API_KEY without code changes", async () => {
    vi.stubEnv("AI_BASE_URL", "https://other.example.com/v1");
    vi.stubEnv("AI_MODEL", "other-model");
    vi.stubEnv("AI_API_KEY", "OTHER-KEY");
    fetchMock.mockResolvedValue(
      aiResponse({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] })
    );
    await completeChat(baseRequest());
    expect(fetchMock.mock.calls[0][0]).toBe("https://other.example.com/v1/chat/completions");
    expect(requestBody()).toMatchObject({ model: "other-model" });
    expect(requestInit().headers).toMatchObject({
      Authorization: "Bearer OTHER-KEY",
    });
  });

  it("adds response_format only for the json responseFormat", async () => {
    fetchMock.mockResolvedValue(aiResponse({ choices: [{ message: { content: "{}" } }] }));
    await completeChat(baseRequest({ responseFormat: "json" }));
    expect(requestBody()).toMatchObject({ response_format: { type: "json_object" } });

    fetchMock.mockResolvedValue(aiResponse({ choices: [{ message: { content: "ok" } }] }));
    await completeChat(baseRequest());
    expect(requestBody().response_format).toBeUndefined();
  });

  it("throws cap_reached without calling fetch when the reservation is denied", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const error = await captureError(() => completeChat(baseRequest()));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("cap_reached");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it("settles the actual cost from usage token counts", async () => {
    fetchMock.mockResolvedValue(
      aiResponse({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })
    );
    const completion = await completeChat(baseRequest());
    expect(completion.inputTokens).toBe(10);
    expect(completion.outputTokens).toBe(5);
    expect(completion.costMicros).toBe(costMicros(10, 5, INPUT_PRICE, OUTPUT_PRICE));
    const values = mockExecuteRaw.mock.calls[0].slice(1);
    expect(values).toEqual([BigInt(RESERVE), BigInt(costMicros(10, 5, INPUT_PRICE, OUTPUT_PRICE)), `${period}`]);
  });

  it("settles the reservation and returns null usage when usage is missing", async () => {
    fetchMock.mockResolvedValue(
      aiResponse({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] })
    );
    const completion = await completeChat(baseRequest());
    expect(completion.inputTokens).toBeNull();
    expect(completion.outputTokens).toBeNull();
    expect(completion.costMicros).toBe(RESERVE);
    const values = mockExecuteRaw.mock.calls[0].slice(1);
    expect(values).toEqual([BigInt(RESERVE), BigInt(RESERVE), `${period}`]);
  });

  it("settles a cost of 0 when the provider returns 500", async () => {
    fetchMock.mockResolvedValue(new Response("broken", { status: 500 }));
    const error = await captureError(() => completeChat(baseRequest()));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("http");
    expect((error as AiError).status).toBe(500);
    expect((error as AiError).message).toBe("AI provider returned 500");
    const values = mockExecuteRaw.mock.calls[0].slice(1);
    expect(values).toEqual([BigInt(RESERVE), BigInt(0), `${period}`]);
  });

  it("settles the reservation when the request times out", async () => {
    vi.stubEnv("AI_TIMEOUT_MS", "1000");
    fetchMock.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted due to timeout");
            error.name = "TimeoutError";
            reject(error);
          });
        })
    );
    const error = await captureError(() => completeChat(baseRequest()));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("timeout");
    expect(mockExecuteRaw.mock.calls.length).toBe(1);
    expect(mockExecuteRaw.mock.calls[0].slice(1)).toEqual([BigInt(RESERVE), BigInt(RESERVE), `${period}`]);
  });

  it("settles the reservation when fetch fails with a network error", async () => {
    fetchMock.mockRejectedValue(new Error("connection reset"));
    const error = await captureError(() => completeChat(baseRequest()));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("network");
    expect(mockExecuteRaw.mock.calls[0].slice(1)).toEqual([BigInt(RESERVE), BigInt(RESERVE), `${period}`]);
  });

  it("settles the reservation and throws malformed for a 2xx body without content", async () => {
    fetchMock.mockResolvedValue(aiResponse({ choices: [] }));
    const error = await captureError(() => completeChat(baseRequest()));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("malformed");
    expect(mockExecuteRaw.mock.calls[0].slice(1)).toEqual([BigInt(RESERVE), BigInt(RESERVE), `${period}`]);
  });

  it("settles the reservation and throws malformed when the 2xx body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>not json</html>", { status: 200 }));
    const error = await captureError(() => completeChat(baseRequest()));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("malformed");
    expect(mockExecuteRaw.mock.calls[0].slice(1)).toEqual([BigInt(RESERVE), BigInt(RESERVE), `${period}`]);
  });

  it("throws config naming only the variable when AI_API_KEY is missing", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const error = await captureError(() => completeChat(baseRequest()));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("config");
    expect((error as AiError).message).toBe("Missing required environment variable AI_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it("throws accounting and never calls fetch when the reservation query fails", async () => {
    mockQueryRaw.mockRejectedValue(new Error("database unavailable"));
    const error = await captureError(() => completeChat(baseRequest()));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("accounting");
    expect((error as AiError).message).toBe("AI spend could not be reserved");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it("throws aborted with no DB or fetch when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await captureError(() => completeChat(baseRequest({ signal: controller.signal })));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("aborted");
    expect((error as AiError).message).toBe("AI request was cancelled");
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws aborted and settles the reservation when the caller aborts mid-fetch", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted mid-flight");
    });
    const error = await captureError(() => completeChat(baseRequest({ signal: controller.signal })));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("aborted");
    expect(mockExecuteRaw.mock.calls[0].slice(1)).toEqual([BigInt(RESERVE), BigInt(RESERVE), `${period}`]);
  });

  it("throws timeout and settles the reservation when json parsing is interrupted by timeout", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      json: async () => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      },
    } as unknown as Response);
    const error = await captureError(() => completeChat(baseRequest()));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("timeout");
    expect(mockExecuteRaw.mock.calls[0].slice(1)).toEqual([BigInt(RESERVE), BigInt(RESERVE), `${period}`]);
  });

  it("returns the completion even when settlement runs against a row it cannot find", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecuteRaw.mockResolvedValue(0);
    try {
      fetchMock.mockResolvedValue(aiResponse({ choices: [{ message: { content: "hi" } }] }));
      const completion = await completeChat(baseRequest());
      expect(completion.text).toBe("hi");
      expect(consoleSpy).toHaveBeenCalledWith("AI spend settlement failed");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("still rejects with the provider http error when settlement fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecuteRaw.mockRejectedValue(new Error("database down"));
    try {
      fetchMock.mockResolvedValue(new Response("broken", { status: 500 }));
      const error = await captureError(() => completeChat(baseRequest()));
      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).kind).toBe("http");
      expect((error as AiError).status).toBe(500);
      expect(consoleSpy).toHaveBeenCalledWith("AI spend settlement failed");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("treats usage token counts beyond the safe integer range as missing", async () => {
    fetchMock.mockResolvedValue(
      aiResponse({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1e20, completion_tokens: 5 },
      })
    );
    const completion = await completeChat(baseRequest());
    expect(completion.inputTokens).toBeNull();
    expect(completion.outputTokens).toBeNull();
    expect(completion.costMicros).toBe(RESERVE);
    expect(mockExecuteRaw.mock.calls[0].slice(1)).toEqual([BigInt(RESERVE), BigInt(RESERVE), `${period}`]);
  });

  it("keeps using the reserve-time period when the month rolls over during the call", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-31T23:59:59Z"));
      fetchMock.mockImplementation(async () => {
        vi.setSystemTime(new Date("2026-11-01T00:00:01Z"));
        return aiResponse({ choices: [{ message: { content: "ok" } }] });
      });
      await completeChat(baseRequest());
      const reserveValues = mockQueryRaw.mock.calls[0].slice(1);
      expect(reserveValues[0]).toBe("2026-10");
      const settleValues = mockExecuteRaw.mock.calls[0].slice(1);
      expect(settleValues[2]).toBe("2026-10");
    } finally {
      vi.useRealTimers();
    }
  });

  it("always sends the environment key, even if the request carries an apiKey property", async () => {
    fetchMock.mockResolvedValue(aiResponse({ choices: [{ message: { content: "ok" } }] }));
    const request = { ...baseRequest({ feature: "test" }), apiKey: "REQUEST-KEY" } as unknown as AiRequest;
    const completion = await completeChat(request);
    expect(completion.text).toBe("ok");
    expect(requestInit().headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
  });

  it("throws invalid_request and touches nothing when maxOutputTokens is out of range", async () => {
    const error = await captureError(() => completeChat(baseRequest({ maxOutputTokens: 0 })));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("invalid_request");
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    const tooBig = await captureError(() =>
      completeChat(baseRequest({ maxOutputTokens: 32769 }))
    );
    expect((tooBig as AiError).kind).toBe("invalid_request");
  });

  it("throws invalid_request and touches nothing when messages are empty", async () => {
    const error = await captureError(() => completeChat(baseRequest({ messages: [] })));
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("invalid_request");
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sets the spend period from the current UTC month at reserve time", async () => {
    fetchMock.mockResolvedValue(aiResponse({ choices: [{ message: { content: "ok" } }] }));
    await completeChat(baseRequest());
    const queryArgs = mockQueryRaw.mock.calls[0].slice(1);
    expect(queryArgs).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\d{4}-\d{2}$/), BigInt(RESERVE), BigInt(RESERVE), expect.anything(), expect.anything()])
    );
  });
});
