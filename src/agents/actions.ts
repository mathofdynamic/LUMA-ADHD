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

export const AGENT_ACQUISITION_OPERATIONS = [
  "SEARCH_MEMORY",
  "SEARCH_DOCUMENTS",
  "READ_DOCUMENT",
  "READ_DOCUMENT_VERSION",
  "LIST_RELEVANT_FILES",
] as const;

export type AgentAcquisitionOperation = (typeof AGENT_ACQUISITION_OPERATIONS)[number];

export interface AgentAction {
  readonly intent: AgentIntent;
  readonly content: string | null;
  readonly confidence: number;
  readonly reasonSummary: string;
  readonly targetAgentId: string | null;
  readonly targetThreadId: string | null;
  readonly metadata: JsonObject;
}

export interface AgentAcquisitionRequest {
  readonly operation: AgentAcquisitionOperation;
  readonly query: string | null;
  readonly logicalPath: string | null;
  readonly versionNumber: number | null;
  readonly limit: number;
}

export type AgentStep =
  | { readonly kind: "action"; readonly action: AgentAction }
  | { readonly kind: "acquisition"; readonly request: AgentAcquisitionRequest };

export class AgentActionValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid agent action: ${problems.join("; ")}`);
    this.name = "AgentActionValidationError";
    this.problems = problems;
  }
}

export class AgentAcquisitionValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid agent acquisition request: ${problems.join("; ")}`);
    this.name = "AgentAcquisitionValidationError";
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

function validateAgentAcquisition(value: unknown): AgentAcquisitionRequest {
  const problems: string[] = [];
  if (!isRecord(value)) throw new AgentAcquisitionValidationError(["response must be a JSON object"]);
  if (value.step !== "ACQUIRE") problems.push("step must be ACQUIRE");
  const operation = value.operation;
  if (typeof operation !== "string" || !(AGENT_ACQUISITION_OPERATIONS as readonly string[]).includes(operation)) {
    problems.push(`operation must be one of ${AGENT_ACQUISITION_OPERATIONS.join(", ")}`);
  }
  const query = value.query === null || value.query === undefined ? null : value.query;
  if (query !== null && (typeof query !== "string" || query.trim().length === 0 || Array.from(query).length > 500)) {
    problems.push("query must be null or a non-empty string of at most 500 characters");
  }
  const logicalPath = value.logical_path === null || value.logical_path === undefined ? null : value.logical_path;
  if (logicalPath !== null && (typeof logicalPath !== "string" || logicalPath.trim().length === 0 || Array.from(logicalPath).length > 512)) {
    problems.push("logical_path must be null or a non-empty path of at most 512 characters");
  }
  const versionNumber = value.version_number === null || value.version_number === undefined ? null : value.version_number;
  if (versionNumber !== null && (typeof versionNumber !== "number" || !Number.isInteger(versionNumber) || versionNumber < 1 || versionNumber > 500)) {
    problems.push("version_number must be null or an integer from 1 to 500");
  }
  const limit = value.limit === undefined || value.limit === null ? 5 : value.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 10) {
    problems.push("limit must be an integer from 1 to 10");
  }
  const operationValue = operation as AgentAcquisitionOperation;
  if (["SEARCH_MEMORY", "SEARCH_DOCUMENTS"].includes(operationValue) && query === null) {
    problems.push(`${operationValue} requires query`);
  }
  if (["READ_DOCUMENT", "READ_DOCUMENT_VERSION"].includes(operationValue) && logicalPath === null) {
    problems.push(`${operationValue} requires logical_path`);
  }
  if (operationValue === "READ_DOCUMENT_VERSION" && versionNumber === null) {
    problems.push("READ_DOCUMENT_VERSION requires version_number");
  }
  if (problems.length > 0) throw new AgentAcquisitionValidationError(problems);
  return {
    operation: operationValue,
    query: query as string | null,
    logicalPath: logicalPath as string | null,
    versionNumber: versionNumber as number | null,
    limit: limit as number,
  };
}

export function parseAgentStep(text: string): AgentStep {
  let value: unknown;
  try {
    value = parseJsonText(text);
  } catch (error: unknown) {
    throw new AgentActionValidationError([`response must be valid JSON: ${String(error).slice(0, 180)}`]);
  }
  if (isRecord(value) && value.step === "ACQUIRE") {
    return { kind: "acquisition", request: validateAgentAcquisition(value) };
  }
  return { kind: "action", action: validateAgentAction(value) };
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
    "metadata": {"type": "object", "description": "For FILE_WORK, fileWork.operation may be create_document, read_document, edit_document, search_documents, delete_document, restore_document, document_history, read_document_version, reference_document, share_document, or list_documents."}
  }
}`;

export const AGENT_ACQUISITION_SCHEMA = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["step", "operation", "query", "logical_path", "version_number", "limit"],
  "properties": {
    "step": {"const": "ACQUIRE"},
    "operation": {"type": "string", "enum": ["SEARCH_MEMORY", "SEARCH_DOCUMENTS", "READ_DOCUMENT", "READ_DOCUMENT_VERSION", "LIST_RELEVANT_FILES"]},
    "query": {"type": ["string", "null"], "maxLength": 500},
    "logical_path": {"type": ["string", "null"], "maxLength": 512},
    "version_number": {"type": ["integer", "null"], "minimum": 1, "maximum": 500},
    "limit": {"type": "integer", "minimum": 1, "maximum": 10}
  }
}`;

// OpenAI strict structured outputs require a single closed object with every
// property declared as required. The application parser still owns the
// semantic distinction between an action and an acquisition step. Nullable
// fields keep that wire contract compatible with both existing contracts.
export const AGENT_STEP_JSON_SCHEMA: Readonly<Record<string, unknown>> = {
  type: "object",
  additionalProperties: false,
  properties: {
    step: { type: "string", enum: ["ACTION", "ACQUIRE"] },
    intent: { type: ["string", "null"] },
    content: { type: ["string", "null"], maxLength: 600 },
    confidence: { type: ["number", "null"] },
    reason_summary: { type: ["string", "null"], maxLength: 80 },
    target_agent_id: { type: ["string", "null"] },
    target_thread_id: { type: ["string", "null"] },
    metadata: { type: "object", properties: {}, required: [], additionalProperties: false },
    operation: { type: ["string", "null"] },
    query: { type: ["string", "null"], maxLength: 500 },
    logical_path: { type: ["string", "null"], maxLength: 512 },
    version_number: { type: ["integer", "null"] },
    limit: { type: ["integer", "null"] },
  },
  required: [
    "step", "intent", "content", "confidence", "reason_summary", "target_agent_id", "target_thread_id",
    "metadata", "operation", "query", "logical_path", "version_number", "limit",
  ],
};

export const AGENT_STEP_SCHEMA = `one of these two JSON contracts:
FINAL ACTION:
${AGENT_ACTION_SCHEMA}
BOUNDED ACQUISITION REQUEST:
${AGENT_ACQUISITION_SCHEMA}`;

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
