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
