import { describe, expect, it } from "vitest";
import { LLMProviderError } from "../src/llm/errors";
import { OpenAIProvider } from "../src/llm/openai";

function okResponse(body: Record<string, unknown>, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("OpenAI Responses provider", () => {
  it("sends the verified Responses contract and parses nested output text and usage", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return okResponse({
        id: "resp_test",
        model: "gpt-5.6-sol",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({ intent: "WAIT", reason_summary: "No contribution." }) }],
        }],
        usage: { input_tokens: 21, output_tokens: 8, total_tokens: 29 },
      }, { "x-request-id": "req_test" });
    };
    const provider = new OpenAIProvider({ apiKey: "test-secret", fetcher, maxAttempts: 1 });

    const result = await provider.generate({
      modelKey: "gpt-5.6-sol",
      systemPrompt: "You are GOD.",
      messages: [{ role: "user", content: "Return WAIT." }],
      temperature: 0,
      reasoningEffort: "high",
      maxOutputTokens: 800,
      structuredOutput: {
        name: "luma_wait",
        schema: {
          type: "object",
          properties: { intent: { type: "string" }, reason_summary: { type: "string" } },
          required: ["intent", "reason_summary"],
          additionalProperties: false,
        },
      },
    });

    expect(calls[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe("Bearer test-secret");
    const body = requestBody(calls[0]?.init);
    expect(body.store).toBe(false);
    expect(body.instructions).toBe("You are GOD.");
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.temperature).toBeUndefined();
    expect((body.text as Record<string, unknown>).format).toMatchObject({ type: "json_schema", strict: true, name: "luma_wait" });
    expect(result.text).toContain('"WAIT"');
    expect(result.requestId).toBe("req_test");
    expect(result.usage).toEqual({ promptTokens: 21, completionTokens: 8, totalTokens: 29 });
  });

  it("normalizes authentication, rate-limit, and timeout failures without exposing bodies", async () => {
    const authentication = new OpenAIProvider({
      apiKey: "test-secret",
      maxAttempts: 1,
      fetcher: async () => new Response("provider body", { status: 401 }),
    });
    await expect(authentication.generate({ modelKey: "gpt-5.6-sol", systemPrompt: "x", messages: [] })).rejects.toMatchObject({
      failure: { kind: "authentication", retryable: false, status: 401 },
    });

    const rateLimited = new OpenAIProvider({
      apiKey: "test-secret",
      maxAttempts: 1,
      fetcher: async () => new Response("provider body", { status: 429, headers: { "retry-after": "3" } }),
    });
    await expect(rateLimited.generate({ modelKey: "gpt-5.6-sol", systemPrompt: "x", messages: [] })).rejects.toMatchObject({
      failure: { kind: "rate_limited", retryable: true, status: 429, retryAfterSeconds: 3 },
    });

    const timedOut = new OpenAIProvider({
      apiKey: "test-secret",
      maxAttempts: 1,
      fetcher: async () => { throw new DOMException("aborted", "AbortError"); },
    });
    await expect(timedOut.generate({ modelKey: "gpt-5.6-sol", systemPrompt: "x", messages: [] })).rejects.toBeInstanceOf(LLMProviderError);
    try {
      await timedOut.generate({ modelKey: "gpt-5.6-sol", systemPrompt: "x", messages: [] });
    } catch (error: unknown) {
      expect((error as LLMProviderError).failure.kind).toBe("timeout");
    }
  });
});
