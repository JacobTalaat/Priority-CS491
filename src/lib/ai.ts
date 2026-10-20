import "server-only";
import { costMicros, estimateInputTokens, reserveSpend, settleSpend, spendPeriod } from "@/lib/ai-spend";
import { env } from "@/lib/env";

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

export type AiRequest = {
  feature: string;
  userId?: string;
  messages: AiMessage[];
  maxOutputTokens: number;
  responseFormat?: "text" | "json";
  signal?: AbortSignal;
};

export type AiCompletion = {
  model: string;
  text: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number;
};

export type AiErrorKind =
  | "config"
  | "invalid_request"
  | "accounting"
  | "aborted"
  | "cap_reached"
  | "http"
  | "timeout"
  | "network"
  | "malformed";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;

  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.status = status;
  }
}

const MAX_OUTPUT_TOKENS = 32768;

async function settle(period: string, reserve: number, cost: number): Promise<void> {
  try {
    await settleSpend({ period, reserveMicros: reserve, costMicros: cost });
  } catch {
    console.error("AI spend settlement failed");
  }
}

function throwConfig(caught: unknown): never {
  const message = caught instanceof Error ? caught.message : "AI configuration is missing or invalid";
  throw new AiError("config", message);
}

function abortTimeoutOrFallthrough(request: AiRequest, caught: unknown, fallback: () => AiError): AiError {
  if (request.signal?.aborted) {
    return new AiError("aborted", "AI request was cancelled");
  }
  if (caught instanceof Error && caught.name === "TimeoutError") {
    return new AiError("timeout", "AI request timed out");
  }
  return fallback();
}

function extractText(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const root = parsed as Record<string, unknown>;
  const choices = root["choices"];
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    return null;
  }
  const message = (first as Record<string, unknown>)["message"];
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const content = (message as Record<string, unknown>)["content"];
  if (typeof content !== "string") {
    return null;
  }
  return content;
}

function extractFinishReason(parsed: unknown): string | null {
  const choices = (parsed as Record<string, unknown>)["choices"];
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    return null;
  }
  const finishReason = (first as Record<string, unknown>)["finish_reason"];
  return typeof finishReason === "string" ? finishReason : null;
}

function extractUsage(parsed: unknown): { inputTokens: number; outputTokens: number } | null {
  const usage = (parsed as Record<string, unknown>)["usage"];
  if (typeof usage !== "object" || usage === null) {
    return null;
  }
  const inputTokens = (usage as Record<string, unknown>)["prompt_tokens"];
  const outputTokens = (usage as Record<string, unknown>)["completion_tokens"];
  const isTokenCount = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (!isTokenCount(inputTokens) || !isTokenCount(outputTokens)) {
    return null;
  }
  return { inputTokens, outputTokens };
}

export async function completeChat(request: AiRequest): Promise<AiCompletion> {
  if (request.messages.length === 0) {
    throw new AiError("invalid_request", "AI request must include at least one message");
  }
  if (
    !Number.isInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < 1 ||
    request.maxOutputTokens > MAX_OUTPUT_TOKENS
  ) {
    throw new AiError(
      "invalid_request",
      `AI request maxOutputTokens must be an integer between 1 and ${MAX_OUTPUT_TOKENS}`
    );
  }

  let baseUrl: string;
  let model: string;
  let apiKey: string;
  let inputPrice: number;
  let outputPrice: number;
  let budget: number;
  let timeoutMs: number;
  try {
    baseUrl = env.aiBaseUrl;
    model = env.aiModel;
    apiKey = env.aiApiKey;
    inputPrice = env.aiInputMicrosPerMillion;
    outputPrice = env.aiOutputMicrosPerMillion;
    budget = env.aiMonthlyBudgetMicros;
    timeoutMs = env.aiTimeoutMs;
  } catch (caught) {
    throwConfig(caught);
  }

  if (request.signal?.aborted) {
    throw new AiError("aborted", "AI request was cancelled");
  }

  const period = spendPeriod(new Date());
  const reserve = costMicros(
    estimateInputTokens(request.messages),
    request.maxOutputTokens,
    inputPrice,
    outputPrice
  );

  let reserved: boolean;
  try {
    reserved = await reserveSpend({
      period,
      reserveMicros: reserve,
      capMicros: budget,
    });
  } catch {
    throw new AiError("accounting", "AI spend could not be reserved");
  }
  if (!reserved) {
    throw new AiError("cap_reached", "AI spending cap reached for this month");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        stream: false,
        ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(request.signal ? [request.signal] : []),
      ]),
    });
  } catch (caught) {
    const error = abortTimeoutOrFallthrough(request, caught, () =>
      new AiError("network", "AI request failed to reach the provider")
    );
    await settle(period, reserve, reserve);
    throw error;
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    await settle(period, reserve, 0);
    throw new AiError("http", `AI provider returned ${response.status}`, response.status);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (caught) {
    const error = abortTimeoutOrFallthrough(request, caught, () =>
      new AiError("malformed", "AI provider returned a malformed response")
    );
    await settle(period, reserve, reserve);
    throw error;
  }

  const text = extractText(parsed);
  if (text === null) {
    await settle(period, reserve, reserve);
    throw new AiError("malformed", "AI provider returned a malformed response");
  }

  const usage = extractUsage(parsed);
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cost = reserve;
  if (usage !== null) {
    inputTokens = usage.inputTokens;
    outputTokens = usage.outputTokens;
    cost = costMicros(usage.inputTokens, usage.outputTokens, inputPrice, outputPrice);
  }

  await settle(period, reserve, cost);

  return {
    model,
    text,
    finishReason: extractFinishReason(parsed),
    inputTokens,
    outputTokens,
    costMicros: cost,
  };
}
