import { FOUNDATION_GUARDRAILS } from "../guardrails";
import { LLMProviderError, providerFailure } from "./errors";
import type {
  LLMGenerateRequest,
  LLMGenerateResponse,
  LLMProvider,
} from "./types";

export const VERIFIED_NEBULA_BASE_URL = "https://nebula-free-llm.nebula-ai-company.workers.dev/v1";
export const DEFAULT_NEBULA_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

interface NebulaResponse {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly choices?: unknown;
  readonly usage?: unknown;
  readonly error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function failureForStatus(response: Response): LLMProviderError {
  // Do not carry provider response text into D1 events or job errors. The
  // status is sufficient for retry classification and avoids persisting an
  // upstream body that could accidentally echo sensitive request material.
  const message = `Nebula HTTP ${response.status}`;
  const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;

  if (response.status === 401) {
    return providerFailure("authentication", message, { status: response.status, retryable: false });
  }
  if (response.status === 429) {
    return providerFailure("rate_limited", message, {
      status: response.status,
      retryable: true,
      retryAfterSeconds: retryAfter(response),
    });
  }
  if (response.status === 422) {
    return providerFailure("unsupported", message, { status: response.status, retryable: false });
  }

  return providerFailure(
    retryable ? "transient" : "malformed_response",
    message,
    { status: response.status, retryable, retryAfterSeconds: retryAfter(response) },
  );
}

function usageFrom(value: unknown): LLMGenerateResponse["usage"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const promptTokens = finiteNumber(value.prompt_tokens);
  const completionTokens = finiteNumber(value.completion_tokens);
  const totalTokens = finiteNumber(value.total_tokens);
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

function responseText(value: unknown): { text: string; finishReason?: string } | null {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    return null;
  }
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
    return null;
  }
  return {
    text: choice.message.content,
    finishReason: stringValue(choice.finish_reason),
  };
}

export interface NebulaProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetcher?: typeof fetch;
  readonly maxAttempts?: number;
  readonly defaultTimeoutMs?: number;
}

export class NebulaProvider implements LLMProvider {
  readonly name = "nebula";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly maxAttempts: number;
  private readonly defaultTimeoutMs: number;

  constructor(options: NebulaProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl?.trim() || VERIFIED_NEBULA_BASE_URL).replace(/\/+$/u, "");
    this.model = options.model?.trim() || DEFAULT_NEBULA_MODEL;
    this.fetcher = (options.fetcher ?? fetch).bind(globalThis);
    this.maxAttempts = options.maxAttempts ?? FOUNDATION_GUARDRAILS.providerMaxAttempts;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? FOUNDATION_GUARDRAILS.providerTimeoutMilliseconds;

    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 3) {
      throw new Error("Nebula maxAttempts must be between 1 and 3");
    }
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    if (this.apiKey.length === 0) {
      throw providerFailure("configuration", "NEBULA_API_KEY is not configured", { retryable: false });
    }
    if (request.messages.length === 0 && request.systemPrompt.trim().length === 0) {
      throw providerFailure("configuration", "Nebula request must contain at least one message", { retryable: false });
    }

    const model = request.modelKey.trim() || this.model;
    const body = JSON.stringify({
      model,
      messages: [
        ...(request.systemPrompt.trim().length > 0
          ? [{ role: "system", content: request.systemPrompt }]
          : []),
        ...request.messages,
      ],
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
      stream: false,
    });

    let lastFailure: LLMProviderError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        request.timeoutMs ?? this.defaultTimeoutMs,
      );
      const abort = (): void => controller.abort();
      request.signal?.addEventListener("abort", abort, { once: true });

      try {
        const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body,
          signal: controller.signal,
        });
        const responseBodyText = await response.text();
        if (responseBodyText.length > 2_000_000) {
          throw providerFailure("malformed_response", "Nebula response exceeded the 2 MB safety bound", {
            status: response.status,
            retryable: false,
          });
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(responseBodyText) as NebulaResponse;
        } catch {
          throw providerFailure("malformed_response", "Nebula returned invalid JSON", {
            status: response.status,
            retryable: response.status >= 500,
          });
        }
        if (!response.ok) {
          throw failureForStatus(response);
        }

        const content = responseText(parsed);
        if (!content) {
          throw providerFailure("malformed_response", "Nebula response did not contain assistant content", {
            status: response.status,
            retryable: false,
          });
        }
        const result = parsed as NebulaResponse;
        const metadata: Record<string, string> = {};
        const routedVia = response.headers.get("x-routed-via");
        const fallbackAttempts = response.headers.get("x-fallback-attempts");
        if (routedVia) metadata.routedVia = routedVia.slice(0, 200);
        if (fallbackAttempts) metadata.fallbackAttempts = fallbackAttempts.slice(0, 32);

        return {
          text: content.text,
          provider: this.name,
          model: stringValue(result.model) ?? model,
          requestId: stringValue(result.id) ?? response.headers.get("x-request-id") ?? undefined,
          usage: usageFrom(result.usage),
          finishReason: content.finishReason,
          latencyMs: Date.now() - startedAt,
          metadata,
        };
      } catch (error: unknown) {
        if (error instanceof LLMProviderError) {
          lastFailure = error;
        } else if (error instanceof DOMException && error.name === "AbortError") {
          lastFailure = providerFailure("timeout", "Nebula request timed out", { retryable: true });
        } else {
          lastFailure = providerFailure("transient", "Nebula transport failed", { retryable: true });
        }
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", abort);
      }

      if (!lastFailure?.failure.retryable || attempt >= this.maxAttempts) {
        throw lastFailure ?? providerFailure("unknown", "Nebula request failed", { retryable: false });
      }
    }

    throw lastFailure ?? providerFailure("unknown", "Nebula request failed", { retryable: false });
  }

  async health(): Promise<{ readonly ok: boolean; readonly provider: string }> {
    try {
      const response = await this.fetcher(`${this.baseUrl.replace(/\/v1$/u, "")}/health`, { method: "GET" });
      return { ok: response.ok, provider: this.name };
    } catch {
      return { ok: false, provider: this.name };
    }
  }
}
