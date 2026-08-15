import type { JsonObject } from "../database/validation";
import { FOUNDATION_GUARDRAILS } from "../guardrails";

export const AGENT_INTENTS = [
  "SPEAK",
  "WAIT",
  "REQUEST_AGENT",
  "REQUEST_HUMAN",
  "PROPOSE_THREAD",
  "REOPEN_THREAD",
  "FILE_WORK",
  "DRAW",
  "VOTE",
] as const;

export type AgentIntent = (typeof AGENT_INTENTS)[number];

export interface AgentAction {
  readonly intent: AgentIntent;
  readonly content: string | null;
  readonly confidence: number;
  readonly reasonSummary: string;
  readonly targetAgentId: string | null;
  readonly targetThreadId: string | null;
  readonly metadata: JsonObject;
}

export class AgentActionValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid agent action: ${problems.join("; ")}`);
    this.name = "AgentActionValidationError";
    this.problems = problems;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function repairInvalidUnicodeEscapes(text: string): string {
  let repaired = "";
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      repaired += character;
      inString = !inString;
      continue;
    }
    if (!inString || character !== "\\") {
      repaired += character;
      continue;
    }

    const next = text[index + 1];
    if (next === undefined) {
      repaired += "\\\\";
      continue;
    }
    if ('"\\/bfnrt'.includes(next)) {
      repaired += `\\${next}`;
      index += 1;
      continue;
    }
    if (next === "u" && /^[0-9a-f]{4}$/iu.test(text.slice(index + 2, index + 6))) {
      repaired += text.slice(index, index + 6);
      index += 5;
      continue;
    }

    repaired += "\\\\";
  }

  return repaired;
}

function readNullableString(value: unknown, field: string, problems: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    problems.push(`${field} must be a non-empty string or null`);
    return null;
  }
  return value;
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const source = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(source) as unknown;
  } catch (error: unknown) {
    if (!/unicode escape/iu.test(String(error))) throw error;
    return JSON.parse(repairInvalidUnicodeEscapes(source)) as unknown;
  }
}

export function validateAgentAction(value: unknown): AgentAction {
  const problems: string[] = [];
  if (!isRecord(value)) {
    throw new AgentActionValidationError(["response must be a JSON object"]);
  }

  const intent = value.intent;
  if (typeof intent !== "string" || !(AGENT_INTENTS as readonly string[]).includes(intent)) {
    problems.push(`intent must be one of ${AGENT_INTENTS.join(", ")}`);
  }

  const confidence = value.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    problems.push("confidence must be a number between 0 and 1");
  }

  const reasonSummary = value.reason_summary;
  if (typeof reasonSummary !== "string" || reasonSummary.trim().length === 0) {
    problems.push("reason_summary must be a non-empty string");
  } else if (Array.from(reasonSummary).length > 160) {
    problems.push("reason_summary must not exceed 160 characters");
  }

  let content: string | null = null;
  if (value.content !== undefined && value.content !== null) {
    if (typeof value.content !== "string") {
      problems.push("content must be a string or null");
    } else {
      content = value.content;
      const maxContentCharacters = Math.min(4_096, FOUNDATION_GUARDRAILS.maxAgentActionContentCharacters);
      if (Array.from(content).length > maxContentCharacters) {
        problems.push(`content must not exceed ${maxContentCharacters} characters`);
      }
    }
  }

  const targetAgentId = readNullableString(value.target_agent_id, "target_agent_id", problems);
  const targetThreadId = readNullableString(value.target_thread_id, "target_thread_id", problems);
  const metadata = value.metadata === undefined ? {} : value.metadata;
  if (!isJsonObject(metadata)) problems.push("metadata must be a JSON object");

  if (intent === "SPEAK" && (content === null || content.trim().length === 0)) {
    problems.push("SPEAK requires non-empty content");
  }
  if (intent === "PROPOSE_THREAD" && (content === null || content.trim().length === 0)) {
    problems.push("PROPOSE_THREAD requires non-empty content");
  }
  if ((intent === "SPEAK" || intent === "WAIT") && targetAgentId !== null) {
    problems.push(`target_agent_id must be null for ${intent}`);
  }

  if (problems.length > 0) throw new AgentActionValidationError(problems);

  return {
    intent: intent as AgentIntent,
    content,
    confidence: confidence as number,
    reasonSummary: reasonSummary as string,
    targetAgentId,
    targetThreadId,
    metadata: metadata as JsonObject,
  };
}

export function parseAgentAction(text: string): AgentAction {
  let value: unknown;
  try {
    value = parseJsonText(text);
  } catch (error: unknown) {
    throw new AgentActionValidationError([`response must be valid JSON: ${String(error).slice(0, 180)}`]);
  }
  return validateAgentAction(value);
}

export const AGENT_ACTION_SCHEMA = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["intent", "confidence", "reason_summary", "target_agent_id", "target_thread_id", "metadata"],
  "properties": {
    "intent": {"type": "string", "enum": ["SPEAK", "WAIT", "REQUEST_AGENT", "REQUEST_HUMAN", "PROPOSE_THREAD", "REOPEN_THREAD", "FILE_WORK", "DRAW", "VOTE"]},
    "content": {"type": ["string", "null"], "description": "Required for SPEAK and PROPOSE_THREAD; absent or null for WAIT."},
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "reason_summary": {"type": "string", "maxLength": 160},
    "target_agent_id": {"type": ["string", "null"]},
    "target_thread_id": {"type": ["string", "null"]},
    "metadata": {"type": "object"}
  }
}`;

export function actionExample(): string {
  return JSON.stringify({
    intent: "SPEAK",
    content: "<b>پیشنهاد من:</b>\n• یک تست کوچک با کاربران جدید\n• اندازه‌گیری نرخ فعال‌سازی (<code>Activation Rate</code>)",
    confidence: 0.72,
    reason_summary: "یک گام قابل‌آزمون برای تصمیم‌گیری اضافه می‌کند.",
    target_agent_id: null,
    target_thread_id: null,
    metadata: {},
  });
}
