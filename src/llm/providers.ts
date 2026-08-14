export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  readonly name?: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly jsonSchema: Record<string, unknown>;
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly providerParams?: Readonly<Record<string, unknown>>;
}

export interface ChatResponse {
  readonly message: ChatMessage;
  readonly finishReason: "stop" | "length" | "tool_calls" | "error";
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface LlmProvider {
  readonly name: string;
  chat(request: ChatRequest, options?: { signal?: AbortSignal }): Promise<ChatResponse>;
}
