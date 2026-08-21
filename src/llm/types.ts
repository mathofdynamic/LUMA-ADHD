export type LLMMessageRole = "user" | "assistant";

export interface LLMMessage {
  readonly role: LLMMessageRole;
  readonly content: string;
}

export interface LLMUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
}

export type LLMReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface LLMStructuredOutput {
  readonly name: string;
  readonly description?: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export type LLMFailureKind =
  | "authentication"
  | "rate_limited"
  | "timeout"
  | "malformed_response"
  | "transient"
  | "unsupported"
  | "configuration"
  | "unknown";

export interface LLMFailure {
  readonly kind: LLMFailureKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
}

export interface LLMGenerateRequest {
  readonly modelKey: string;
  readonly systemPrompt: string;
  readonly messages: readonly LLMMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly reasoningEffort?: LLMReasoningEffort;
  readonly structuredOutput?: LLMStructuredOutput;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface LLMGenerateResponse {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly requestId?: string;
  readonly usage?: LLMUsage;
  readonly finishReason?: string;
  readonly latencyMs: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface LLMProvider {
  readonly name: string;
  generate(request: LLMGenerateRequest): Promise<LLMGenerateResponse>;
  health?(): Promise<{ readonly ok: boolean; readonly provider: string }>;
}
