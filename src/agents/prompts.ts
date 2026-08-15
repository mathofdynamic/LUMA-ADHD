import type {
  AgentInterestRecord,
  AgentRecord,
  AgentSpecialtyRecord,
  MessageRecord,
  ThreadRecord,
} from "../database/types";
import { AGENT_ACTION_SCHEMA, actionExample } from "./actions";
import type { LLMMessage } from "../llm";

export interface AgentPromptContext {
  readonly agent: AgentRecord;
  readonly specialties: readonly AgentSpecialtyRecord[];
  readonly interests: readonly AgentInterestRecord[];
  readonly thread: ThreadRecord;
  readonly wakeReason: string;
  readonly recentMessages: readonly MessageRecord[];
  readonly addressedAgentId?: string | null;
  readonly requestedAgentIds?: readonly string[];
  readonly reputationContext?: Readonly<Record<string, number>>;
  readonly memoryContext?: readonly string[];
  readonly fileContext?: readonly string[];
}

export interface BuiltAgentPrompt {
  readonly systemPrompt: string;
  readonly messages: readonly LLMMessage[];
}

const ORGANIZATION_CONSTITUTION = [
  "LUMA ADHD is a persistent internal organization for useful, evidence-aware thinking about LUMA.",
  "D1 is canonical. Telegram is a visible projection, not an internal agent-to-agent bus.",
  "Do not manufacture chatter. A bounded WAIT is better than repetition, while useful progress should not be suppressed.",
  "Use only the supplied context. Do not invent research, credentials, hidden tool results, or private chain-of-thought.",
  "Correctness, evidence, safety, and the structured action contract outrank personality or agreement.",
].join("\n");

function containsPersian(value: string): boolean {
  return /[\u0600-\u06ff]/u.test(value);
}

function formatMessage(message: MessageRecord): string {
  const author = message.authorType === "agent"
    ? `agent:${message.authorAgentId ?? "unknown"}`
    : message.authorType;
  return `[${message.createdAt}] ${author}: ${message.contentText}`;
}

function compactList(values: readonly string[], limit: number): string {
  return values.slice(0, limit).join("، ") || "none";
}

export function buildAgentPrompt(context: AgentPromptContext): BuiltAgentPrompt {
  const recentMessages = context.recentMessages.slice(-12);
  const recentText = recentMessages.map(formatMessage).join("\n") || "No recent messages are available.";
  const discussionText = recentMessages.map((message) => message.contentText).join("\n");
  const language = containsPersian(discussionText) ? "Persian" : "the active discussion language";
  const specialties = context.specialties
    .map((item) => `${item.domain}: ${item.description}`)
    .join("; ") || context.agent.specialty;
  const interests = context.interests.map((item) => item.interest);
  const reputation = context.reputationContext
    ? JSON.stringify(context.reputationContext)
    : "No reputation signal is available in Phase 03.";
  const memory = compactList(context.memoryContext ?? [], 4);
  const files = compactList(context.fileContext ?? [], 4);

  const systemPrompt = [
    "You are one normal LUMA ADHD agent. Return exactly one validated JSON action and no prose outside JSON.",
    ORGANIZATION_CONSTITUTION,
    `Active response language: ${language}. Keep internal JSON field names in English; write human-facing content in the discussion language.`,
    "\nAGENT IDENTITY",
    `id: ${context.agent.id}`,
    `display_name: ${context.agent.displayName}`,
    `specialty: ${context.agent.specialty}`,
    `specialty_description: ${context.agent.specialtyDescription}`,
    `specialties: ${specialties}`,
    `Soul (decision priorities, not a catchphrase): ${context.agent.soul}`,
    `Personality (communication behavior only): ${context.agent.personality}`,
    `Interests: ${compactList(interests, 12)}`,
    "\nCURRENT WORK",
    `thread_id: ${context.thread.id}`,
    `thread_title: ${context.thread.title}`,
    `thread_state: ${context.thread.state}`,
    `thread_objective: ${context.thread.summary ?? context.thread.title}`,
    `wake_reason: ${context.wakeReason}`,
    `addressed_agent_id: ${context.addressedAgentId ?? "none"}`,
    `requested_agent_ids: ${context.requestedAgentIds?.join(", ") || "none"}`,
    `recent_messages:\n${recentText}`,
    `relevant_reputation_context: ${reputation}`,
    `relevant_memory_context: ${memory}`,
    `relevant_file_context: ${files}`,
    "\nAVAILABLE ACTIONS",
    "SPEAK publishes a useful message through your mapped persona. WAIT remains internal and is invisible in Telegram.",
    "REQUEST_AGENT records an internal request for another agent; it never sends a Telegram bot-to-bot message.",
    "REQUEST_HUMAN creates a bounded human task. PROPOSE_THREAD and REOPEN_THREAD use durable thread state.",
    "FILE_WORK and DRAW are deferred capability signals in Phase 03. VOTE records a structured foundation only.",
    `\nOUTPUT SCHEMA\n${AGENT_ACTION_SCHEMA}`,
    `Valid example:\n${actionExample()}`,
    "Keep content concise (at most 400 Unicode characters) and reason_summary concise (at most 160 characters).",
    "Use literal UTF-8 Persian or English text in string values. Do not emit \\uXXXX escapes.",
    "Return one complete JSON object without Markdown fences, prose, or chain-of-thought.",
    "reason_summary is a short audit-friendly rationale, not hidden reasoning. Do not include chain-of-thought.",
  ].join("\n");

  return {
    systemPrompt,
    messages: [{ role: "user", content: "Choose the single most useful next action for this bounded turn." }],
  };
}
