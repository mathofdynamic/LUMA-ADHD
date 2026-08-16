import type {
  AgentInterestRecord,
  AgentRecord,
  AgentSpecialtyRecord,
  MessageRecord,
  ThreadRecord,
} from "../database/types";
import { AGENT_ACTION_SCHEMA, actionExample } from "./actions";
import type { LLMMessage } from "../llm";

export interface PromptParticipant {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "agent" | "human";
}

export interface AgentPromptContext {
  readonly agent: AgentRecord;
  readonly specialties: readonly AgentSpecialtyRecord[];
  readonly interests: readonly AgentInterestRecord[];
  readonly thread: ThreadRecord;
  readonly wakeReason: string;
  readonly recentMessages: readonly MessageRecord[];
  readonly addressedAgentId?: string | null;
  readonly requestedAgentIds?: readonly string[];
  readonly participants?: readonly PromptParticipant[];
  readonly humanDisplayName?: string | null;
  readonly reputationContext?: Readonly<Record<string, string | number>>;
  readonly memoryContext?: readonly string[];
  readonly fileContext?: readonly string[];
  readonly retrievedContext?: string;
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

export const TELEGRAM_PRESENTATION_GUIDANCE = [
  "Telegram presentation: SPEAK content is projected with parse_mode=HTML.",
  "Use only these tags when they genuinely improve scanning: <b>, <i>, <code>, <blockquote>, and safe <a href=\"https://...\"> links.",
  "Never emit Markdown markers such as **bold**, __underline__, ### headings, Markdown fences, or emoji-numbered list markers.",
  "When directly addressing a known participant, bold only that participant's exact canonical name, for example <b>سارا</b>، ... . Do not bold the sentence or every occurrence of a name.",
  "Do not address the human by name unless it adds clarity or the human explicitly asked for a direct reply; start with the contribution when no address is needed.",
  "If this turn replies to another message, Telegram already shows the reply context. Do not restate the whole replied-to message; contribute directly.",
  "Choose the lightest structure that helps: one or two short paragraphs for an opinion; • bullets for unordered items; 1. numbered items only when order matters; <b>پیشنهاد من:</b> or <b>ریسک اصلی:</b> only when useful.",
  "Use short Persian paragraphs, natural punctuation, and نیم‌فاصله where appropriate. Keep one main contribution per turn. Do not pad the response.",
  "Use <code>Activation Rate</code>, <code>p95</code>, or another short literal identifier only when it improves technical clarity. Do not put ordinary English business words in code formatting.",
  "Formatting is not personality. Let the idea determine the structure; do not use a fixed template for every agent.",
  "Examples (choose one pattern only when it fits):",
  "SHORT: به‌نظرم مشکل اصلی خود قابلیت‌ها نیست؛ مسیر رسیدن کاربر به اولین نتیجه هنوز مبهم است.\n\nاگر کاربر در دو دقیقه اول خروجی مفیدی نگیرد، تنوع ابزارها هم کمک زیادی نمی‌کند.",
  "ADDRESS: <b>رادین</b>، با بخش اول موافقم؛ از دید رشد باید بدانیم کاربران مناسب اصلاً وارد این مسیر می‌شوند یا نه.",
  "PROPOSAL: <b>پیشنهاد من:</b>\n• یک مسیر کوتاه برای اولین ارزش\n• یک تست با کاربران جدید\n\n<b>معیار موفقیت:</b> نرخ فعال‌سازی (<code>Activation Rate</code>) در دو دقیقه اول.",
  "COMPARISON: <b>نسخه A</b>\nویدیوی کوتاه برای معرفی ارزش.\n\n<b>نسخه B</b>\nفلوی تعاملی برای رساندن کاربر به اولین نتیجه.\n\n<b>انتخاب من:</b> نسخه B، چون رفتار واقعی را بهتر می‌سنجد.",
  "CRITIQUE: <b>ریسک اصلی:</b> ممکن است آموزش طولانی، رسیدن به ارزش را عقب بیندازد.\n\n<b>جایگزین:</b> یک مسیر سه‌مرحله‌ای و قابل‌آزمون.",
  "METRIC: برای تصمیم‌گیری، نرخ فعال‌سازی (<code>Activation Rate</code>) و زمان رسیدن به اولین ارزش را در دو گروه مقایسه می‌کنم.",
  "PLAIN: اگر داده کافی نداریم، یک تست کوچک طراحی کنیم و بعد درباره تغییر بزرگ تصمیم بگیریم.",
].join("\n");

function containsPersian(value: string): boolean {
  return /[\u0600-\u06ff]/u.test(value);
}

function formatMessage(
  message: MessageRecord,
  participants: ReadonlyMap<string, PromptParticipant>,
  humanDisplayName: string | null | undefined,
): string {
  const authorId = message.authorAgentId ?? message.authorUserId;
  const participant = authorId ? participants.get(authorId) : undefined;
  const author = participant?.displayName
    ?? (message.authorType === "human" ? humanDisplayName ?? "human" : message.authorType);
  const reply = message.replyToMessageId ? ` reply_to:${message.replyToMessageId}` : "";
  return `[${message.createdAt}] ${author}${reply}: ${message.contentText}`;
}

function compactList(values: readonly string[], limit: number): string {
  return values.slice(0, limit).join(", ") || "none";
}

export function buildAgentPrompt(context: AgentPromptContext): BuiltAgentPrompt {
  const recentMessages = context.recentMessages.slice(-12);
  const participants = context.participants ?? [];
  const participantMap = new Map(participants.map((participant) => [participant.id, participant]));
  const recentText = recentMessages
    .map((message) => formatMessage(message, participantMap, context.humanDisplayName))
    .join("\n") || "No recent messages are available.";
  const discussionText = recentMessages.map((message) => message.contentText).join("\n");
  const language = containsPersian(discussionText) ? "Persian" : "the active discussion language";
  const specialties = context.specialties
    .map((item) => `${item.domain}: ${item.description}`)
    .join("; ") || context.agent.specialty;
  const interests = context.interests.map((item) => item.interest);
  const reputation = context.reputationContext
    ? JSON.stringify(context.reputationContext)
    : "No coarse reputation signal is available.";
  const memory = compactList(context.memoryContext ?? [], 4);
  const files = compactList(context.fileContext ?? [], 4);
  const participantText = participants
    .map((participant) => `${participant.kind}:${participant.id} = ${participant.displayName}`)
    .join(", ") || "none";
  const addressedParticipant = context.addressedAgentId
    ? participantMap.get(context.addressedAgentId)
    : undefined;

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
    `addressed_agent_name: ${addressedParticipant?.displayName ?? "none"}`,
    `requested_agent_ids: ${context.requestedAgentIds?.join(", ") || "none"}`,
    `known_participants: ${participantText}`,
    `recent_messages:\n${recentText}`,
    `relevant_reputation_context: ${reputation}`,
    `relevant_memory_context: ${memory}`,
    `relevant_file_context: ${files}`,
    `bounded_retrieval_context:\n${context.retrievedContext ?? "none"}`,
    "\nAVAILABLE ACTIONS",
    "SPEAK publishes a useful message through your mapped persona. WAIT remains internal and is invisible in Telegram.",
    "REQUEST_AGENT records an internal request for another agent; it never sends a Telegram bot-to-bot message.",
    "REQUEST_HUMAN creates a bounded human task. PROPOSE_THREAD and REOPEN_THREAD use durable thread state.",
    "FILE_WORK executes one validated application-level document operation per turn (create_document, read_document, edit_document, search_documents, reference_document, or share_document). It never grants SQL or filesystem access. DRAW remains deferred to Phase 07. VOTE records a structured foundation only.",
    "\nTELEGRAM COMMUNICATION STYLE",
    TELEGRAM_PRESENTATION_GUIDANCE,
    `\nOUTPUT SCHEMA\n${AGENT_ACTION_SCHEMA}`,
    `Valid example:\n${actionExample()}`,
    "Keep content concise (at most 4096 Unicode characters is a safety ceiling, not a target) and reason_summary concise (at most 160 characters).",
    "Use literal UTF-8 Persian or English text in string values. Do not emit \\uXXXX escapes.",
    "Return one complete JSON object without Markdown fences, prose, or chain-of-thought.",
    "reason_summary is a short audit-friendly rationale, not hidden reasoning. Do not include chain-of-thought.",
  ].join("\n");

  return {
    systemPrompt,
    messages: [{ role: "user", content: "Choose the single most useful next action for this bounded turn." }],
  };
}
