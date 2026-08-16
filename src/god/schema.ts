import { ValidationError } from "../database/errors";
import { isNormalAgentId, isSupportedReputationDomain, normalizeReputationDomain } from "../reputation/model";
import { REPUTATION_DIMENSIONS, type GodReviewOutput } from "../reputation/types";

export const GOD_REVIEW_OUTPUT_SCHEMA = `{
  "executive_summary": "short summary",
  "important_findings": ["..."],
  "weak_reasoning": ["..."],
  "unsupported_assumptions": ["..."],
  "high_value_work": ["..."],
  "unresolved_risks": ["..."],
  "missing_perspectives": ["..."],
  "thread_recommendations": [{"thread_id": "optional", "recommendation": "..."}],
  "agent_evaluations": [{"agent_id": "agent-product", "domain": "product_strategy", "dimension": "contribution", "signal": 0.2, "rationale": "short evidence-based rationale", "source_message_id": "optional"}],
  "human_required": ["..."],
  "directives": [{"target_agent_id": "optional", "target_thread_id": "optional", "directive": "...", "priority": 50}],
  "public_summary": "optional concise Telegram summary"
}`;

// OpenAI Structured Outputs requires every property to be declared in the
// required list when strict mode is enabled. Nullable fields preserve the
// provider-neutral parser's optional semantics without making the wire output
// ambiguous.
export const GOD_REVIEW_JSON_SCHEMA: Readonly<Record<string, unknown>> = {
  type: "object",
  additionalProperties: false,
  properties: {
    executive_summary: { type: "string", maxLength: 2_000 },
    important_findings: { type: "array", items: { type: "string", maxLength: 600 }, maxItems: 12 },
    weak_reasoning: { type: "array", items: { type: "string", maxLength: 600 }, maxItems: 12 },
    unsupported_assumptions: { type: "array", items: { type: "string", maxLength: 600 }, maxItems: 12 },
    high_value_work: { type: "array", items: { type: "string", maxLength: 600 }, maxItems: 12 },
    unresolved_risks: { type: "array", items: { type: "string", maxLength: 600 }, maxItems: 12 },
    missing_perspectives: { type: "array", items: { type: "string", maxLength: 600 }, maxItems: 12 },
    thread_recommendations: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          thread_id: { type: ["string", "null"] },
          recommendation: { type: "string", maxLength: 700 },
        },
        required: ["thread_id", "recommendation"],
      },
    },
    agent_evaluations: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          agent_id: { type: "string", enum: [
            "agent-product", "agent-growth", "agent-creative", "agent-technical",
            "agent-finance", "agent-customer", "agent-operations", "agent-heretic",
          ] },
          domain: { type: "string", enum: [
            "product_strategy", "growth", "ux_creative", "engineering_architecture",
            "finance_pricing", "customer_experience", "operations", "critical_analysis", "general",
          ] },
          dimension: { type: "string", enum: ["epistemic", "contribution", "outcome", "collaboration"] },
          signal: { type: "number", minimum: -1, maximum: 1 },
          rationale: { type: "string", maxLength: 500 },
          source_message_id: { type: ["string", "null"] },
        },
        required: ["agent_id", "domain", "dimension", "signal", "rationale", "source_message_id"],
      },
    },
    human_required: { type: "array", items: { type: "string", maxLength: 600 }, maxItems: 12 },
    directives: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          target_agent_id: { type: ["string", "null"] },
          target_thread_id: { type: ["string", "null"] },
          directive: { type: "string", maxLength: 700 },
          priority: { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["target_agent_id", "target_thread_id", "directive", "priority"],
      },
    },
    public_summary: { type: ["string", "null"], maxLength: 1_600 },
  },
  required: [
    "executive_summary", "important_findings", "weak_reasoning", "unsupported_assumptions",
    "high_value_work", "unresolved_risks", "missing_perspectives", "thread_recommendations",
    "agent_evaluations", "human_required", "directives", "public_summary",
  ],
};

export class GodReviewOutputValidationError extends ValidationError {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid GOD review output: ${problems.join("; ")}`);
    this.name = "GodReviewOutputValidationError";
    this.problems = problems;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GodReviewOutputValidationError(["response must be a JSON object"]);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new GodReviewOutputValidationError([`${field} must be non-empty text`]);
  if (Array.from(value).length > max) throw new GodReviewOutputValidationError([`${field} exceeds ${max} characters`]);
  return value.trim();
}

function textList(value: unknown, field: string, maxItems = 12, maxChars = 600): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new GodReviewOutputValidationError([`${field} must be an array with at most ${maxItems} items`]);
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, maxChars));
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, field, max);
}

export function parseGodReviewOutput(text: string): GodReviewOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GodReviewOutputValidationError(["response is not valid JSON"]);
  }
  const value = objectValue(parsed);
  const executiveSummary = requiredText(value.executive_summary, "executive_summary", 2_000);
  const threadRecommendations = (() => {
    if (value.thread_recommendations === undefined) return [];
    if (!Array.isArray(value.thread_recommendations) || value.thread_recommendations.length > 12) throw new GodReviewOutputValidationError(["thread_recommendations is invalid"]);
    return value.thread_recommendations.map((item, index) => {
      const object = objectValue(item);
      return {
        threadId: optionalText(object.thread_id, `thread_recommendations[${index}].thread_id`, 160),
        recommendation: requiredText(object.recommendation, `thread_recommendations[${index}].recommendation`, 700),
      };
    });
  })();
  const agentEvaluations = (() => {
    if (value.agent_evaluations === undefined) return [];
    if (!Array.isArray(value.agent_evaluations) || value.agent_evaluations.length > 20) throw new GodReviewOutputValidationError(["agent_evaluations is invalid"]);
    return value.agent_evaluations.map((item, index) => {
      const object = objectValue(item);
      const agentId = requiredText(object.agent_id, `agent_evaluations[${index}].agent_id`, 80);
      if (!isNormalAgentId(agentId)) throw new GodReviewOutputValidationError([`agent_evaluations[${index}].agent_id is not a normal agent`]);
      const rawDomain = requiredText(object.domain, `agent_evaluations[${index}].domain`, 80);
      if (!isSupportedReputationDomain(rawDomain)) throw new GodReviewOutputValidationError([`agent_evaluations[${index}].domain is invalid`]);
      const domain = normalizeReputationDomain(rawDomain);
      const rawDimension = requiredText(object.dimension, `agent_evaluations[${index}].dimension`, 40);
      if (!REPUTATION_DIMENSIONS.includes(rawDimension as typeof REPUTATION_DIMENSIONS[number])) throw new GodReviewOutputValidationError([`agent_evaluations[${index}].dimension is invalid`]);
      const signal = object.signal;
      if (typeof signal !== "number" || !Number.isFinite(signal) || signal < -1 || signal > 1) throw new GodReviewOutputValidationError([`agent_evaluations[${index}].signal must be between -1 and 1`]);
      return {
        agentId,
        domain,
        dimension: rawDimension as typeof REPUTATION_DIMENSIONS[number],
        signal,
        rationale: requiredText(object.rationale, `agent_evaluations[${index}].rationale`, 500),
        sourceMessageId: optionalText(object.source_message_id, `agent_evaluations[${index}].source_message_id`, 160),
      };
    });
  })();
  const directives = (() => {
    if (value.directives === undefined) return [];
    if (!Array.isArray(value.directives) || value.directives.length > 12) throw new GodReviewOutputValidationError(["directives is invalid"]);
    return value.directives.map((item, index) => {
      const object = objectValue(item);
      const targetAgentId = optionalText(object.target_agent_id, `directives[${index}].target_agent_id`, 80);
      if (targetAgentId !== undefined && !isNormalAgentId(targetAgentId)) throw new GodReviewOutputValidationError([`directives[${index}].target_agent_id is not a normal agent`]);
      const targetThreadId = optionalText(object.target_thread_id, `directives[${index}].target_thread_id`, 160);
      const priority = object.priority === undefined ? 50 : object.priority;
      if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0 || priority > 100) throw new GodReviewOutputValidationError([`directives[${index}].priority is invalid`]);
      return { targetAgentId, targetThreadId, directive: requiredText(object.directive, `directives[${index}].directive`, 700), priority };
    });
  })();
  return {
    executiveSummary,
    importantFindings: textList(value.important_findings, "important_findings"),
    weakReasoning: textList(value.weak_reasoning, "weak_reasoning"),
    unsupportedAssumptions: textList(value.unsupported_assumptions, "unsupported_assumptions"),
    highValueWork: textList(value.high_value_work, "high_value_work"),
    unresolvedRisks: textList(value.unresolved_risks, "unresolved_risks"),
    missingPerspectives: textList(value.missing_perspectives, "missing_perspectives"),
    threadRecommendations,
    agentEvaluations,
    humanRequired: textList(value.human_required, "human_required"),
    directives,
    publicSummary: optionalText(value.public_summary, "public_summary", 1_600),
  };
}
