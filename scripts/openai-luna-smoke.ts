import { AGENT_STEP_JSON_SCHEMA, parseAgentStep } from "../src/agents/actions";
import { GOD_REVIEW_JSON_SCHEMA, parseGodReviewOutput } from "../src/god/schema";
import { LLMProviderError, OpenAIProvider, VERIFIED_OPENAI_MODEL } from "../src/llm";

const apiKey = process.env.GPT_API_KEY?.trim() ?? "";
if (apiKey.length === 0) {
  console.log("GPT_API_KEY_AVAILABLE=false");
  process.exitCode = 2;
} else {
  console.log("GPT_API_KEY_AVAILABLE=true");
  const provider = new OpenAIProvider({ apiKey, model: VERIFIED_OPENAI_MODEL, maxAttempts: 1 });
  const startedAt = Date.now();
  try {
    const agentResponse = await provider.generate({
      modelKey: VERIFIED_OPENAI_MODEL,
      systemPrompt: [
        "You are performing a bounded provider smoke for LUMA ADHD.",
        "Return one valid ACTION object matching the supplied schema.",
        "Use SPEAK with a short, useful Persian sentence answering the user.",
        "Do not emit hidden reasoning, Markdown fences, or extra fields.",
        JSON.stringify(AGENT_STEP_JSON_SCHEMA),
      ].join("\n"),
      messages: [{ role: "user", content: "در یک جمله کوتاه فارسی بگو لوما برای چه کاری است." }],
      reasoningEffort: "medium",
      maxOutputTokens: 512,
      structuredOutput: {
        name: "luma_agent_step_smoke",
        description: "A bounded normal-Agent step smoke.",
        schema: AGENT_STEP_JSON_SCHEMA,
      },
    });
    const agentStep = parseAgentStep(agentResponse.text);
    if (agentStep.kind !== "action" || !["SPEAK", "WAIT"].includes(agentStep.action.intent)) {
      throw new Error("normal Agent smoke returned an unexpected action");
    }
    console.log("OPENAI_LUNA_AGENT_SMOKE=success");
    console.log(`OPENAI_LUNA_AGENT_INTENT=${agentStep.action.intent}`);
    console.log(`OPENAI_LUNA_AGENT_USAGE_AVAILABLE=${agentResponse.usage !== undefined}`);
    console.log(`OPENAI_LUNA_AGENT_REQUEST_ID_PRESENT=${agentResponse.requestId !== undefined}`);
    console.log(`OPENAI_LUNA_AGENT_LATENCY_MS=${agentResponse.latencyMs}`);

    const godResponse = await provider.generate({
      modelKey: VERIFIED_OPENAI_MODEL,
      systemPrompt: [
        "You are performing a tiny bounded GOD provider smoke for LUMA ADHD.",
        "Return a valid structured review with a concise executive summary.",
        "Use empty arrays for all findings, evaluations, directives, and recommendations.",
        "Do not emit hidden reasoning, Markdown fences, or extra fields.",
      ].join("\n"),
      messages: [{ role: "user", content: "This is only a provider contract smoke. Return an empty review." }],
      reasoningEffort: "xhigh",
      maxOutputTokens: 1_200,
      structuredOutput: {
        name: "luma_god_review_smoke",
        description: "A tiny bounded GOD review smoke.",
        schema: GOD_REVIEW_JSON_SCHEMA,
      },
    });
    const godOutput = parseGodReviewOutput(godResponse.text);
    if (godOutput.agentEvaluations.length !== 0 || godOutput.directives.length !== 0) {
      throw new Error("GOD smoke returned non-empty durable-action collections");
    }
    console.log("OPENAI_LUNA_GOD_SMOKE=success");
    console.log("OPENAI_LUNA_GOD_REASONING_EFFORT=xhigh");
    console.log(`OPENAI_LUNA_GOD_USAGE_AVAILABLE=${godResponse.usage !== undefined}`);
    console.log(`OPENAI_LUNA_GOD_REQUEST_ID_PRESENT=${godResponse.requestId !== undefined}`);
    console.log(`OPENAI_LUNA_TOTAL_ELAPSED_MS=${Date.now() - startedAt}`);
  } catch (error: unknown) {
    console.error(`OPENAI_LUNA_SMOKE_FAILURE=${error instanceof LLMProviderError ? `${error.failure.kind}${error.failure.status === undefined ? "" : `_${error.failure.status}`}` : "validation_or_unknown"}`);
    process.exitCode = 1;
  }
}
