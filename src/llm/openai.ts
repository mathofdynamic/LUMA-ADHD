import { FOUNDATION_GUARDRAILS } from "../guardrails";
import { LLMProviderError, providerFailure } from "./errors";
import type {
  LLMGenerateRequest,
  LLMGenerateResponse,
  LLMProvider,
  LLMStructuredOutput,
  LLMUsage,
} from "./types";

export const VERIFIED_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const VERIFIED_OPENAI_MODEL = "gpt-5.6-sol";

interface OpenAIResponse {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly status?: unknown;
  readonly incomplete_details?: unknown;
  readonly output_text?: unknown;
  readonly output?: unknown;
  readonly usage?: unknown;
  readonly error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function usageFrom(value: unknown): LLMUsage | undefined {
  if (!isRecord(value)) return undefined;
  const promptTokens = finiteNumber(value.input_tokens) ?? finiteNumber(value.prompt_tokens);
  const completionTokens = finiteNumber(value.output_tokens) ?? finiteNumber(value.completion_tokens);
  const totalTokens = finiteNumber(value.total_tokens);
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

function textFromContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.flatMap((part) => {
    if (!isRecord(part) || part.type !== "output_text") return [];
    const text = stringValue(part.text);
    return text === undefined ? [] : [text];
  });
  return parts.length === 0 ? undefined : parts.join("\n");
}

function responseText(value: OpenAIResponse): { readonly text: string; readonly finishReason?: string } | null {
  const directText = stringValue(value.output_text);
  if (directText !== undefined) {
    return { text: directText, finishReason: stringValue(value.status) };
  }
  if (!Array.isArray(value.output)) return null;
  const text = value.output.flatMap((item) => {
    if (!isRecord(item) || item.type !== "message") return [];
    const content = textFromContent(item.content);
    return content === undefined ? [] : [content];
  }).join("\n");
  return text.length === 0 ? null : { text, finishReason: stringValue(value.status) };
}

function formatForStructuredOutput(output: LLMStructuredOutput): Record<string, unknown> {
  return {
    type: "json_schema",
    name: output.name,
    ...(output.description === undefined ? {} : { description: output.description }),
    strict: true,
    schema: output.schema,
  };
}

function failureForStatus(response: Response): LLMProviderError {
  const retryAfterSeconds = retryAfter(response);
  if (response.status === 401 || response.status === 403) {
    return providerFailure("authentication", `OpenAI HTTP ${response.status}`, {
      status: response.status,
      retryable: false,
    });
  }
  if (response.status === 429) {
    return providerFailure("rate_limited", "OpenAI HTTP 429", {
      status: response.status,
      retryable: true,
      retryAfterSeconds,
    });
  }
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return providerFailure("unsupported", `OpenAI HTTP ${response.status}`, {
      status: response.status,
      retryable: false,
    });
  }
  const retryable = response.status === 408 || response.status === 425 || response.status >= 500;
  return providerFailure(retryable ? "transient" : "malformed_response", `OpenAI HTTP ${response.status}`, {
    status: response.status,
    retryable,
    retryAfterSeconds,
  });
}

export interface OpenAIProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetcher?: typeof fetch;
  readonly maxAttempts?: number;
  readonly defaultTimeoutMs?: number;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly maxAttempts: number;
  private readonly defaultTimeoutMs: number;

  constructor(options: OpenAIProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl?.trim() || VERIFIED_OPENAI_BASE_URL).replace(/\/+$/u, "");
    this.model = options.model?.trim() || VERIFIED_OPENAI_MODEL;
    this.fetcher = (options.fetcher ?? fetch).bind(globalThis);
    this.maxAttempts = options.maxAttempts ?? FOUNDATION_GUARDRAILS.providerMaxAttempts;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? FOUNDATION_GUARDRAILS.providerTimeoutMilliseconds;

    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 3) {
      throw new Error("OpenAI maxAttempts must be between 1 and 3");
    }
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    if (this.apiKey.length === 0) {
      throw providerFailure("configuration", "GOD_API_KEY is not configured", { retryable: false });
    }
    if (request.messages.length === 0 && request.systemPrompt.trim().length === 0) {
      throw providerFailure("configuration", "OpenAI request must contain at least one message", { retryable: false });
    }

    const model = request.modelKey.trim() || this.model;
    const body: Record<string, unknown> = {
      model,
      store: false,
      ...(request.systemPrompt.trim().length === 0 ? {} : { instructions: request.systemPrompt }),
      input: request.messages.map((message) => ({ role: message.role, content: message.content })),
      ...(request.maxOutputTokens === undefined ? {} : { max_output_tokens: request.maxOutputTokens }),
      ...(request.reasoningEffort === undefined ? {} : { reasoning: { effort: request.reasoningEffort } }),
      ...(request.structuredOutput === undefined ? {} : { text: { format: formatForStructuredOutput(request.structuredOutput) } }),
      // Reasoning models do not use the Chat Completions temperature control.
      // The normalized request remains provider-neutral; omit it when effort is set.
      ...(request.temperature === undefined || request.reasoningEffort !== undefined ? {} : { temperature: request.temperature }),
    };
    const serializedBody = JSON.stringify(body);

    let lastFailure: LLMProviderError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.defaultTimeoutMs);
      const abort = (): void => controller.abort();
      request.signal?.addEventListener("abort", abort, { once: true });

      try {
        const response = await this.fetcher(`${this.baseUrl}/responses`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: serializedBody,
          signal: controller.signal,
        });
        const responseBodyText = await response.text();
        if (responseBodyText.length > 2_000_000) {
          throw providerFailure("malformed_response", "OpenAI response exceeded the 2 MB safety bound", {
            status: response.status,
            retryable: false,
          });
        }
        if (!response.ok) throw failureForStatus(response);
        let parsed: OpenAIResponse;
        try {
          parsed = JSON.parse(responseBodyText) as OpenAIResponse;
        } catch {
          throw providerFailure("malformed_response", "OpenAI returned invalid JSON", {
            status: response.status,
            retryable: response.status >= 500,
          });
        }
        const content = responseText(parsed);
        if (!content) {
          throw providerFailure("malformed_response", "OpenAI response did not contain output text", {
            status: response.status,
            retryable: false,
          });
        }
        const metadata: Record<string, string> = {};
        const status = stringValue(parsed.status);
        if (status !== undefined) metadata.responseStatus = status.slice(0, 40);
        const incompleteReason = isRecord(parsed.incomplete_details)
          ? stringValue(parsed.incomplete_details.reason)
          : undefined;
        if (incompleteReason !== undefined) metadata.incompleteReason = incompleteReason.slice(0, 80);

        return {
          text: content.text,
          provider: this.name,
          model: stringValue(parsed.model) ?? model,
          requestId: response.headers.get("x-request-id") ?? stringValue(parsed.id),
          usage: usageFrom(parsed.usage),
          finishReason: content.finishReason,
          latencyMs: Date.now() - startedAt,
          metadata,
        };
      } catch (error: unknown) {
        if (error instanceof LLMProviderError) {
          lastFailure = error;
        } else if (error instanceof DOMException && error.name === "AbortError") {
          lastFailure = providerFailure("timeout", "OpenAI request timed out", { retryable: true });
        } else {
          lastFailure = providerFailure("transient", "OpenAI transport failed", { retryable: true });
        }
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", abort);
      }

      if (!lastFailure?.failure.retryable || attempt >= this.maxAttempts) {
        throw lastFailure ?? providerFailure("unknown", "OpenAI request failed", { retryable: false });
      }
    }

    throw lastFailure ?? providerFailure("unknown", "OpenAI request failed", { retryable: false });
  }

  async health(): Promise<{ readonly ok: boolean; readonly provider: string }> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/models/${encodeURIComponent(this.model)}`, {
        method: "GET",
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      return { ok: response.ok, provider: this.name };
    } catch {
      return { ok: false, provider: this.name };
    }
  }
}
