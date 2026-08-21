import { buildAgentPrompt, buildConversationFocus, type AgentPromptMode } from "../src/agents";

const args = process.argv.slice(2);
const valueAfter = (flag: string, fallback: string): string => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const agentId = valueAfter("--agent", "agent-operations");
const mode = valueAfter("--mode", "interactive") as AgentPromptMode;
const roster: Record<string, { displayName: string; specialty: string; description: string }> = {
  "agent-product": { displayName: "Radin", specialty: "product_strategy", description: "product value and prioritization" },
  "agent-growth": { displayName: "Ava", specialty: "growth", description: "distribution and measurable growth" },
  "agent-creative": { displayName: "Nila", specialty: "ux_creative", description: "UX and visual clarity" },
  "agent-technical": { displayName: "Kian", specialty: "engineering_architecture", description: "architecture and reliability" },
  "agent-finance": { displayName: "Mahsa", specialty: "finance_pricing", description: "pricing and unit economics" },
  "agent-customer": { displayName: "Sara", specialty: "customer_experience", description: "customer trust and friction" },
  "agent-operations": { displayName: "Sam", specialty: "operations", description: "execution and repeatability" },
  "agent-heretic": { displayName: "Kaveh", specialty: "critical_analysis", description: "assumptions and failure modes" },
};
const selected = roster[agentId] ?? roster["agent-operations"];
const thread = {
  id: "prompt-diagnostic-thread",
  chatId: null,
  title: mode === "social" ? "Current social interaction" : "Synthetic prompt diagnostic",
  state: "open",
  priority: 50,
  summary: mode === "social" ? "سلام" : "Synthetic bounded work question",
} as never;
const now = "2026-08-21T00:00:00.000Z";
const message = {
  id: "prompt-diagnostic-message",
  threadId: thread.id,
  chatId: null,
  authorType: "human",
  authorUserId: "synthetic-human",
  authorAgentId: null,
  contentText: mode === "social" ? "سلام" : "یک سؤال مشخص برای بررسی محدود",
  createdAt: now,
  replyToMessageId: null,
  visibility: "public",
  origin: "internal",
  telegramChatId: null,
  telegramMessageId: null,
  telegramBotAlias: null,
  telegramUpdateId: null,
  idempotencyKey: null,
  metadata: {},
  editedAt: null,
  deletedAt: null,
} as never;
const focus = buildConversationFocus({ thread, wakeMessage: message, recentMessages: [message] });
const prompt = buildAgentPrompt({
  agent: {
    id: agentId,
    slug: agentId.replace(/^agent-/u, ""),
    displayName: selected.displayName,
    specialty: selected.specialty,
    specialtyDescription: selected.description,
    soul: "evidence first and useful restraint",
    personality: "calm, precise, and willing to defer",
    rank: 10,
    isActive: true,
    isSupervisor: false,
    config: {},
    metadata: {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  },
  specialties: [{ agentId, domain: selected.specialty, description: selected.description, priority: 100, isPrimary: true }],
  interests: [],
  thread,
  wakeReason: mode === "social" ? "human_message" : "operator_prompt_diagnostic",
  mode,
  recentMessages: [message],
  conversationFocus: focus,
  participants: [{ id: agentId, displayName: selected.displayName, kind: "agent" }, { id: "synthetic-human", displayName: "Human", kind: "human" }],
});

console.log(JSON.stringify({
  agentId,
  mode,
  promptVersion: prompt.systemPrompt.match(/prompt_contract_version: ([^\n]+)/u)?.[1] ?? null,
  characters: prompt.systemPrompt.length,
  lines: prompt.systemPrompt.split("\n").length,
  focus: {
    interactionIntent: focus.interactionIntent,
    primaryQuery: focus.primaryQuery,
    retrievalQuery: focus.retrievalQuery,
    retrievalSkippedReason: focus.retrievalSkippedReason,
  },
  systemPrompt: prompt.systemPrompt,
}, null, 2));
