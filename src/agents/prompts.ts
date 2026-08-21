import type {
  AgentInterestRecord,
  AgentRecord,
  AgentSpecialtyRecord,
  MessageRecord,
  ThreadRecord,
} from "../database/types";
import { AGENT_STEP_SCHEMA, actionExample } from "./actions";
import type { ContextPackTelemetry } from "../memory/types";
import type { LLMMessage } from "../llm";
import type { ConversationFocus } from "./conversation-focus";

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
  readonly retrievalTelemetry?: ContextPackTelemetry;
  readonly acquisitionContext?: readonly string[];
  readonly conversationFocus?: ConversationFocus;
  readonly coveredDomains?: readonly string[];
  readonly contributionRole?: "CONTRIBUTE" | "SYNTHESIZE";
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
  const focus = context.conversationFocus;
  const interactiveHumanWake = /(?:^|_)human(?:_|$)/u.test(context.wakeReason) || context.wakeReason === "new_human_message";
  const covered = context.coveredDomains?.join(", ") || "none";

  const systemPrompt = [
    "You are one normal LUMA ADHD agent. Return exactly one validated JSON step (a bounded acquisition request or a final action) and no prose outside JSON.",
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
    `conversation_focus: ${focus?.primaryQuery ?? context.thread.summary ?? context.thread.title}`,
    `interaction_intent: ${focus?.interactionIntent ?? "substantive"}`,
    `unresolved_question: ${focus?.unresolvedQuestion ?? "none"}`,
    `recent_development: ${focus?.recentDevelopment ?? "none"}`,
    `focus_key_terms: ${focus?.keyTerms.join(", ") || "none"}`,
    `broad_cross_functional_question: ${focus?.isBroadQuestion ? "yes" : "no"}`,
    `current_state_question: ${focus?.isCurrentStateQuestion ? "yes" : "no"}`,
    `covered_perspectives: ${covered}`,
    `contribution_role: ${context.contributionRole ?? "CONTRIBUTE"}`,
    `addressed_agent_id: ${context.addressedAgentId ?? "none"}`,
    `addressed_agent_name: ${addressedParticipant?.displayName ?? "none"}`,
    `requested_agent_ids: ${context.requestedAgentIds?.join(", ") || "none"}`,
    `known_participants: ${participantText}`,
    `recent_messages:\n${recentText}`,
    `relevant_reputation_context: ${reputation}`,
    `relevant_memory_context: ${memory}`,
    `relevant_file_context: ${files}`,
    `persistent_workspace: /agents/${context.agent.slug}/ (private by default); /shared/ (organizational); explicitly shared documents are accessible through validated application operations.`,
    "memory_capability: Automatic bounded retrieval runs before every meaningful turn. You can request a bounded search/read acquisition when the supplied context is insufficient. Search before creating durable work when practical.",
    "grounding_policy: Use supplied authoritative LUMA knowledge for current company/product facts. Official LUMA material outranks generic model memory, unsupported assumptions, and stale casual discussion. Distinguish CURRENT OFFICIAL FACT from PROPOSED CHANGE or OPINION. If stored evidence is insufficient, state uncertainty or acquire more information; do not invent LUMA facts.",
    "grounding_execution: When the retrieval telemetry includes official LUMA knowledge for a factual company/product question, base factual claims on those excerpts. Do not replace them with a generic definition. If the excerpts do not support a claim, qualify it or acquire more information.",
    "evidence_discipline: Distinguish known current facts, observed signals, inferences, hypotheses, and proposals. A current-state ranking such as 'the three main problems' or 'the top priority' requires current evidence; a proposal or future plan is not proof of present reality. If the evidence is insufficient, say so, identify hypotheses, name the missing evidence, or request human input only when genuinely necessary.",
    interactiveHumanWake
      ? "human_priority: This is human-triggered work. Answer or advance the human's actual request first. Do not replace a direct answer with unrelated generic file work, experiments, or organizational activity."
      : "autonomy_priority: This is autonomous work. Durable file or memory work and a bounded WAIT are valid; do not manufacture public speech.",
    "distinct_contribution_contract: Read the recent contributions before acting. If your materially distinct useful contribution is absent, return WAIT. Do not paraphrase a prior Agent, repeat the same problem list, or invent disagreement. Add a new specialist perspective, challenge a weak assumption with evidence, resolve an open question, synthesize distinct contributions when assigned, or WAIT.",
    `coverage_instruction: Already-covered perspectives are ${covered}. Prefer a relevant uncovered perspective when one exists; coverage never overrides subject relevance.`,
    `retrieval_telemetry: ${context.retrievalTelemetry ? JSON.stringify(context.retrievalTelemetry) : "none"}`,
    `bounded_retrieval_context:\n${context.retrievedContext ?? "none"}`,
    `bounded_acquisition_results:\n${context.acquisitionContext?.join("\n\n") || "none"}`,
    "\nAVAILABLE ACTIONS",
    "SPEAK publishes a useful message through your mapped persona. WAIT remains internal and is invisible in Telegram.",
    "REQUEST_AGENT records an internal request for another agent; it never sends a Telegram bot-to-bot message.",
    "REQUEST_HUMAN creates a durable task only after using available LUMA knowledge and memory. Put a concrete request in content and metadata.humanTask with reason, blocking (true only when work cannot responsibly continue), priority, and an optional stable requestKey/category. State what is needed, why it matters, what work it affects, urgency, and whether it blocks. Do not ask vague questions such as 'need more info'.",
    "FILE_WORK executes one validated application-level document operation per turn (create_document, read_document, edit_document, search_documents, delete_document, restore_document, document_history, read_document_version, reference_document, share_document, or list_documents). Delete is reversible soft delete. It never grants SQL or filesystem access. DRAW creates a bounded DiagramSpec artifact when a diagram materially improves understanding; put the typed spec in metadata.diagramSpec and never emit HTML or JavaScript. VOTE records a structured foundation only.",
    "For deeper information use at most a small bounded number of ACQUIRE steps: SEARCH_MEMORY, SEARCH_DOCUMENTS, READ_DOCUMENT, READ_DOCUMENT_VERSION, or LIST_RELEVANT_FILES. Acquisition is not a public answer and must be followed by a final action when enough information is available.",
    "\nTELEGRAM COMMUNICATION STYLE",
    TELEGRAM_PRESENTATION_GUIDANCE,
    `\nOUTPUT SCHEMA\n${AGENT_STEP_SCHEMA}`,
    `Valid example:\n${actionExample()}`,
    "Keep SPEAK content under 1200 Unicode characters, preferably one short paragraph or a few compact bullets, and keep reason_summary under 120 characters. If current evidence is insufficient, prefer WAIT or one concise qualification over a long speculative answer.",
    "Use literal UTF-8 Persian or English text in string values. Do not emit \\uXXXX escapes.",
    "Return one complete JSON object without Markdown fences, prose, or chain-of-thought.",
    "reason_summary is a short audit-friendly rationale, not hidden reasoning. Do not include chain-of-thought.",
  ].join("\n");

  return {
    systemPrompt,
    messages: [{
      role: "user",
      content: interactiveHumanWake
        ? "Answer or advance the human's actual request with one distinct, evidence-aware bounded action. If you cannot add material value beyond the prior contributions, return WAIT."
        : "Choose the single most useful next action for this bounded turn.",
    }],
  };
}
