import type { LLMFailure, LLMFailureKind } from "./types";

function safeMessage(value: unknown): string {
  return String(value)
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/nebula-[A-Za-z0-9_-]+/gu, "[redacted]")
    .slice(0, 500);
}

export class LLMProviderError extends Error {
  readonly failure: LLMFailure;

  constructor(failure: LLMFailure) {
    super(safeMessage(failure.message));
    this.name = "LLMProviderError";
    this.failure = { ...failure, message: safeMessage(failure.message) };
  }
}

export function providerFailure(
  kind: LLMFailureKind,
  message: string,
  options?: Omit<LLMFailure, "kind" | "message">,
): LLMProviderError {
  return new LLMProviderError({
    kind,
    message,
    retryable: options?.retryable ?? false,
    status: options?.status,
    retryAfterSeconds: options?.retryAfterSeconds,
  });
}

export function normalizeProviderError(error: unknown): LLMProviderError {
  if (error instanceof LLMProviderError) {
    return error;
  }

  const message = safeMessage(error);
  if (/abort|timeout/iu.test(message)) {
    return providerFailure("timeout", message, { retryable: true });
  }

  return providerFailure("transient", message, { retryable: true });
}
