import { describe, expect, it } from "vitest";
import { LLMProviderError } from "../src/llm/errors";
import { OpenAIProvider } from "../src/llm/openai";
import { AGENT_STEP_JSON_SCHEMA } from "../src/agents/actions";

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
        model: "gpt-5.6-luna",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({ intent: "WAIT", reason_summary: "No contribution." }) }],
        }],
        usage: { input_tokens: 21, output_tokens: 8, total_tokens: 29, output_tokens_details: { reasoning_tokens: 5 } },
      }, { "x-request-id": "req_test" });
    };
    const provider = new OpenAIProvider({ apiKey: "test-secret", fetcher, maxAttempts: 1 });

    const result = await provider.generate({
      modelKey: "gpt-5.6-luna",
      systemPrompt: "You are GOD.",
      messages: [{ role: "user", content: "Return WAIT." }],
      temperature: 0,
      reasoningEffort: "medium",
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
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.temperature).toBeUndefined();
    expect((body.text as Record<string, unknown>).format).toMatchObject({ type: "json_schema", strict: true, name: "luma_wait" });
    expect(result.text).toContain('"WAIT"');
    expect(result.requestId).toBe("req_test");
    expect(result.usage).toEqual({ promptTokens: 21, completionTokens: 8, totalTokens: 29, reasoningTokens: 5 });
    expect(result.metadata?.reasoningEffort).toBe("medium");
    expect(result.metadata?.reasoningTokens).toBe("5");
  });

  it("normalizes authentication, rate-limit, and timeout failures without exposing bodies", async () => {
    const authentication = new OpenAIProvider({
      apiKey: "test-secret",
      maxAttempts: 1,
      fetcher: async () => new Response("provider body", { status: 401 }),
    });
    await expect(authentication.generate({ modelKey: "gpt-5.6-luna", systemPrompt: "x", messages: [] })).rejects.toMatchObject({
      failure: { kind: "authentication", retryable: false, status: 401 },
    });

    const rateLimited = new OpenAIProvider({
      apiKey: "test-secret",
      maxAttempts: 1,
      fetcher: async () => new Response("provider body", { status: 429, headers: { "retry-after": "3" } }),
    });
    await expect(rateLimited.generate({ modelKey: "gpt-5.6-luna", systemPrompt: "x", messages: [] })).rejects.toMatchObject({
      failure: { kind: "rate_limited", retryable: true, status: 429, retryAfterSeconds: 3 },
    });

    const timedOut = new OpenAIProvider({
      apiKey: "test-secret",
      maxAttempts: 1,
      fetcher: async () => { throw new DOMException("aborted", "AbortError"); },
    });
    await expect(timedOut.generate({ modelKey: "gpt-5.6-luna", systemPrompt: "x", messages: [] })).rejects.toBeInstanceOf(LLMProviderError);
    try {
      await timedOut.generate({ modelKey: "gpt-5.6-luna", systemPrompt: "x", messages: [] });
    } catch (error: unknown) {
      expect((error as LLMProviderError).failure.kind).toBe("timeout");
    }
  });

  it("accepts the closed normal-Agent step schema used by the runtime", async () => {
    const calls: RequestInit[] = [];
    const provider = new OpenAIProvider({
      apiKey: "test-secret",
      maxAttempts: 1,
      fetcher: async (_input, init) => {
        calls.push(init ?? {});
        return okResponse({
          id: "resp_agent_schema",
          model: "gpt-5.6-luna",
          status: "completed",
          output_text: JSON.stringify({
            step: "ACTION",
            intent: "WAIT",
            content: null,
            confidence: 0.5,
            reason_summary: "No distinct contribution.",
            target_agent_id: null,
            target_thread_id: null,
            metadata: {},
            operation: null,
            query: null,
            logical_path: null,
            version_number: null,
            limit: null,
          }),
        });
      },
    });

    await provider.generate({
      modelKey: "gpt-5.6-luna",
      systemPrompt: "Return one action.",
      messages: [{ role: "user", content: "WAIT" }],
      reasoningEffort: "medium",
      structuredOutput: { name: "luma_agent_step", schema: AGENT_STEP_JSON_SCHEMA },
    });
    const body = requestBody(calls[0]);
    expect((body.text as Record<string, unknown>).format).toMatchObject({ type: "json_schema", strict: true });
    expect(((body.text as Record<string, unknown>).format as Record<string, unknown>).schema).toEqual(AGENT_STEP_JSON_SCHEMA);
  });
});
