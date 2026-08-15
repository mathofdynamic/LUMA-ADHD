import { LLMProviderError } from "./errors";
import type {
  LLMGenerateRequest,
  LLMGenerateResponse,
  LLMProvider,
} from "./types";

export type FakeProviderOutcome =
  | LLMGenerateResponse
  | LLMProviderError
  | Error
  | ((request: LLMGenerateRequest, callNumber: number) => LLMGenerateResponse | Promise<LLMGenerateResponse>);

function defaultResponse(request: LLMGenerateRequest): LLMGenerateResponse {
  return {
    text: JSON.stringify({
      intent: "WAIT",
      confidence: 0.5,
      reason_summary: "No useful contribution was selected by the fake provider.",
      target_agent_id: null,
      target_thread_id: null,
      metadata: {},
    }),
    provider: "fake",
    model: request.modelKey,
    finishReason: "stop",
    latencyMs: 0,
  };
}

export class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly calls: LLMGenerateRequest[] = [];
  private readonly outcomes: FakeProviderOutcome[] = [];

  enqueue(...outcomes: FakeProviderOutcome[]): this {
    this.outcomes.push(...outcomes);
    return this;
  }

  enqueueJson(value: unknown, options?: Partial<LLMGenerateResponse>): this {
    this.outcomes.push({
      ...defaultResponse({ modelKey: "fake", systemPrompt: "", messages: [] }),
      ...options,
      text: typeof value === "string" ? value : JSON.stringify(value),
    });
    return this;
  }

  enqueueFailure(error: LLMProviderError | Error): this {
    this.outcomes.push(error);
    return this;
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    this.calls.push(request);
    const outcome = this.outcomes.shift();
    if (outcome === undefined) {
      return defaultResponse(request);
    }
    if (outcome instanceof Error) {
      throw outcome;
    }
    if (typeof outcome === "function") {
      return outcome(request, this.calls.length);
    }
    return {
      ...outcome,
      provider: outcome.provider || this.name,
      model: outcome.model || request.modelKey,
    };
  }
}
