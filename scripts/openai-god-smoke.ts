import { LLMProviderError, OpenAIProvider, VERIFIED_OPENAI_MODEL } from "../src/llm";

const apiKey = process.env.GPT_API_KEY?.trim() ?? "";
if (apiKey.length === 0) {
  console.error("GPT_API_KEY_AVAILABLE=false");
  process.exitCode = 2;
} else {
  const provider = new OpenAIProvider({ apiKey, model: VERIFIED_OPENAI_MODEL });
  try {
    const response = await provider.generate({
      modelKey: VERIFIED_OPENAI_MODEL,
      systemPrompt: "Return one valid structured LUMA response representing WAIT.",
      messages: [{ role: "user", content: "Return WAIT." }],
      reasoningEffort: "xhigh",
      maxOutputTokens: 800,
      structuredOutput: {
        name: "luma_wait_smoke",
        schema: {
          type: "object",
          properties: {
            intent: { type: "string", enum: ["WAIT"] },
            reason_summary: { type: "string" },
          },
          required: ["intent", "reason_summary"],
          additionalProperties: false,
        },
      },
    });
    const parsed = JSON.parse(response.text) as { intent?: unknown; reason_summary?: unknown };
    if (parsed.intent !== "WAIT" || typeof parsed.reason_summary !== "string" || parsed.reason_summary.trim().length === 0) {
      console.error("OPENAI_GOD_SMOKE=malformed_structured_output");
      process.exitCode = 1;
    } else {
      console.log("OPENAI_GOD_SMOKE=success");
      console.log(`OPENAI_GOD_SMOKE_USAGE_AVAILABLE=${response.usage !== undefined}`);
    }
  } catch (error: unknown) {
    console.error(`OPENAI_GOD_SMOKE_FAILURE=${error instanceof LLMProviderError ? error.failure.kind : "unknown"}`);
    process.exitCode = 1;
  }
}
