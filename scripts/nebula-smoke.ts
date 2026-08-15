import { readFileSync, existsSync } from "node:fs";
import { NebulaProvider, DEFAULT_NEBULA_MODEL, VERIFIED_NEBULA_BASE_URL } from "../src/llm/nebula.ts";
import { parseAgentAction } from "../src/agents/actions.ts";

function readLocalKey(): string | undefined {
  if (process.env.NEBULA_API_KEY?.trim()) {
    return process.env.NEBULA_API_KEY.trim();
  }
  if (!existsSync(".nebula-env")) {
    return undefined;
  }
  const line = readFileSync(".nebula-env", "utf8")
    .split(/\r?\n/u)
    .find((value) => /^\s*NEBULA_API_KEY\s*=/u.test(value));
  if (!line) return undefined;
  const value = line.replace(/^\s*NEBULA_API_KEY\s*=\s*/u, "").trim();
  return value.replace(/^['"]|['"]$/gu, "").trim() || undefined;
}

const mode = process.argv[2] === "speak" ? "speak" : "wait";
const apiKey = readLocalKey();
if (!apiKey) {
  console.error("NEBULA_API_KEY is not available in the process environment or ignored .nebula-env");
  process.exit(2);
}

const provider = new NebulaProvider({
  apiKey,
  baseUrl: process.env.NEBULA_BASE_URL || VERIFIED_NEBULA_BASE_URL,
  model: process.env.NEBULA_MODEL || DEFAULT_NEBULA_MODEL,
});
const response = await provider.generate({
  modelKey: process.env.NEBULA_MODEL || DEFAULT_NEBULA_MODEL,
  systemPrompt: [
    "Return exactly one LUMA ADHD action JSON object and no prose.",
    mode === "wait"
      ? "Represent a WAIT action. It must not contain public content."
      : "Represent a concise SPEAK action in Persian about one small, useful LUMA improvement.",
    "Required fields: intent, content, confidence, reason_summary, target_agent_id, target_thread_id, metadata.",
  ].join("\n"),
  messages: [{
    role: "user",
    content: mode === "wait" ? "Run the provider WAIT smoke test." : "Run the provider SPEAK smoke test.",
  }],
  temperature: 0,
  maxOutputTokens: 256,
});
const action = parseAgentAction(response.text);
if ((mode === "wait" && action.intent !== "WAIT") || (mode === "speak" && action.intent !== "SPEAK")) {
  console.error(`Nebula smoke returned ${action.intent}; expected ${mode === "wait" ? "WAIT" : "SPEAK"}`);
  process.exit(3);
}
console.log(JSON.stringify({
  provider: response.provider,
  model: response.model,
  requestIdPresent: response.requestId !== undefined,
  latencyMs: response.latencyMs,
  intent: action.intent,
  schemaValid: true,
  usage: response.usage ?? null,
}));
