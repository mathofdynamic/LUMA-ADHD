import type { MessageRecord, ThreadRecord } from "../database/types";

export type ConversationInteractionIntent =
  | "substantive"
  | "nudge"
  | "social"
  | "acknowledgement"
  | "correction"
  | "topic_reset"
  | "roll_call"
  | "explicit_all_agents";

export type ConversationBoundaryReason =
  | "explicit_telegram_reply"
  | "telegram_topic_binding"
  | "recent_semantic_continuity"
  | "explicit_continuation"
  | "recent_social_thread"
  | "correction_supersedes_active_thread"
  | "topic_reset_new_boundary"
  | "social_new_boundary"
  | "acknowledgement_new_boundary"
  | "roll_call_new_boundary"
  | "ambiguous_temporal_gap"
  | "no_active_thread";

export interface ConversationClassification {
  readonly interactionIntent: ConversationInteractionIntent;
  readonly primaryText: string;
  readonly boundaryReason: ConversationBoundaryReason | null;
  readonly supersedesStaleWork: boolean;
  readonly retrievalSkipped: boolean;
}

export interface ConversationFocusInput {
  readonly thread: ThreadRecord;
  readonly wakeMessage: MessageRecord | null;
  readonly anchorMessage?: MessageRecord | null;
  readonly recentMessages: readonly MessageRecord[];
  readonly currentImagePresent?: boolean;
}

export interface ConversationFocus {
  readonly primaryQuery: string;
  readonly latestHumanMessage: string | null;
  readonly latestHumanMessageAt: string | null;
  readonly interactionIntent: ConversationInteractionIntent;
  readonly boundaryReason: ConversationBoundaryReason | null;
  readonly currentBoundaryAt: string | null;
  readonly retrievalSkippedReason: string | null;
  readonly threadObjective: string;
  readonly recentDevelopment: string | null;
  readonly unresolvedQuestion: string | null;
  readonly keyTerms: readonly string[];
  readonly selectionQuery: string;
  readonly retrievalQuery: string;
  readonly isBroadQuestion: boolean;
  readonly isCurrentStateQuestion: boolean;
  readonly currentImagePresent: boolean;
}

const NUDGE_PATTERNS: readonly RegExp[] = [
  /کسی\s+نیست/u,
  /جواب(?:م|ی)?\s+من/u,
  /پس\s+چی\s+شد/u,
  /ادامه\s+بد(?:ی|ین)/u,
  /منظورم\s+همون/u,
  /نظر\s+(?:بقیه|دیگران)\s+چیه/u,
  /anyone\s+(?:there|answer|respond)/iu,
  /what'?s\s+the\s+status/iu,
  /continue\b/iu,
  /follow[- ]?up/iu,
];

const CORRECTION_PATTERNS: readonly RegExp[] = [
  /گفتم\s+سلام\s+فقط/u,
  /من\s+فقط\s+سلام\s+کردم/u,
  /نه\s+منظورم\s+این\s+نبود/u,
  /that\s+isn'?t\s+what\s+i\s+meant/iu,
  /i\s+only\s+said\s+hello/iu,
];

const RESET_PATTERNS: readonly RegExp[] = [
  /بیخیال\s+اون\s+بحث/u,
  /موضوع\s+قبلی\s+رو\s+ول\s+کنید/u,
  /از\s+اول\s+شروع\s+کنیم/u,
  /بحث\s+قبلی\s+تموم/u,
  /ولش\s+کن/u,
  /بیخیال/u,
  /forget\s+(?:that|the\s+last\s+topic)/iu,
  /start\s+over/iu,
  /drop\s+(?:that|the\s+topic)/iu,
];

const ROLL_CALL_PATTERNS: readonly RegExp[] = [
  /اعلام\s+حضور/u,
  /هر\s*کی.*(?:می.?بینه|می.?بیند).*حاضر/u,
  /همه.*(?:حاضر|حضور)/u,
  /roll\s*call/iu,
  /everyone\s+(?:check\s*in|say\s+you(?:'re|\s+are)\s+here)/iu,
];

const EXPLICIT_ALL_AGENT_PATTERNS: readonly RegExp[] = [
  /همه(?:\s+هشت\s+نفر)?(?:تون|تان)?.*(?:نظر|جواب|پاسخ|بگ(?:ید|ین))/u,
  /نظر\s+تک\s*تک.*(?:agent|نفر|تون|تان)/iu,
  /(?:هر|همه)\s+(?:agent|ایجنت)s?.*(?:نظر|جواب|پاسخ|answer|speak)/iu,
  /(?:all|every|each)\s+(?:eight\s+)?agents?.*(?:answer|opinion|speak|respond)/iu,
];

const SOCIAL_EXACT = new Set([
  "سلام", "سلام بچهها", "صبح بخیر", "شب بخیر", "چه خبر", "خوبین", "خوبید", "جانم", "جونم",
  "hi", "hello", "hey", "good morning", "good night", "how are you",
]);

const ACK_EXACT = new Set([
  "مرسی", "ممنون", "اوکی", "باشه", "فهمیدم", "دمت گرم", "thanks", "ok", "okay", "got it",
]);

const BROAD_PATTERNS: readonly RegExp[] = [
  /بچه‌ها/u,
  /وضعیت\s+(?:فعلی|کلی)/u,
  /مشکل(?:ات)?\s+(?:فعلی|اصلی)/u,
  /مهم‌ترین\s+مسائل/u,
  /نظرت(?:ون|ان)\s+درباره/u,
  /بررسی\s+کن(?:ید|یم)/u,
  /تمرکز\s+کن(?:یم|ید)/u,
  /cross[- ]functional/iu,
  /overall\s+(?:status|problems)/iu,
  /what\s+should\s+we\s+focus/iu,
];

const CURRENT_PATTERNS: readonly RegExp[] = [
  /فعلی/u, /الان/u, /امروز/u, /در\s+حال\s+حاضر/u,
  /current/iu, /today/iu, /right\s+now/iu, /currently/iu,
];

const STOP_TERMS = new Set([
  "است", "هست", "چی", "چیست", "برای", "یک", "و", "در", "به", "از", "با", "را", "که", "این", "آن", "من", "ما", "شما", "بچه", "بچهها",
  "the", "is", "are", "a", "an", "and", "for", "in", "to", "of", "with", "what", "does", "please", "tell", "me", "we", "our",
]);

export function normalizeConversationText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[يى]/gu, "ی")
    .replace(/[ك]/gu, "ک")
    .replace(/[ۀة]/gu, "ه")
    .replace(/[\u200c\u200d\u200e\u200f]/gu, "")
    .replace(/[؟?!.,؛:،]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function isHuman(message: MessageRecord): boolean {
  return message.authorType === "human" || (message.authorType === "system" && message.authorUserId !== null);
}

function uniqueMessages(input: ConversationFocusInput): readonly MessageRecord[] {
  const byId = new Map<string, MessageRecord>();
  for (const message of [...input.recentMessages, input.anchorMessage, input.wakeMessage]) {
    if (message) byId.set(message.id, message);
  }
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function isNudge(value: string): boolean {
  const normalized = normalizeConversationText(value);
  return normalized.length < 120 && NUDGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isCorrection(value: string): boolean {
  const normalized = normalizeConversationText(value);
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isTopicReset(value: string): boolean {
  const normalized = normalizeConversationText(value);
  return RESET_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isSocial(value: string): boolean {
  const normalized = normalizeConversationText(value);
  if (!normalized || normalized.length > 40) return false;
  if (/^[😂🤣❤️❤👍👏🙏]+$/u.test(normalized)) return true;
  return SOCIAL_EXACT.has(normalized);
}

function isAcknowledgement(value: string): boolean {
  const normalized = normalizeConversationText(value);
  return normalized.length <= 32 && ACK_EXACT.has(normalized);
}

function isSubstantiveHuman(message: MessageRecord): boolean {
  return isHuman(message) && !isNudge(message.contentText) && !isSocial(message.contentText)
    && !isAcknowledgement(message.contentText) && !isCorrection(message.contentText) && !isTopicReset(message.contentText);
}

function keyTerms(value: string): readonly string[] {
  const terms = normalizeConversationText(value).match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(terms.filter((term) => !STOP_TERMS.has(term)))].slice(0, 12);
}

function cap(value: string, characters: number): string {
  return Array.from(value).slice(0, characters).join("");
}

function messageAtOrAfter(messages: readonly MessageRecord[], boundaryAt: string | null): readonly MessageRecord[] {
  if (!boundaryAt) return messages;
  return messages.filter((message) => message.createdAt >= boundaryAt);
}

export function classifyConversationIntent(value: string): ConversationClassification {
  const normalized = normalizeConversationText(value);
  if (isCorrection(normalized)) {
    return { interactionIntent: "correction", primaryText: value.trim(), boundaryReason: "correction_supersedes_active_thread", supersedesStaleWork: true, retrievalSkipped: true };
  }
  if (isTopicReset(normalized)) {
    return { interactionIntent: "topic_reset", primaryText: value.trim(), boundaryReason: "topic_reset_new_boundary", supersedesStaleWork: true, retrievalSkipped: true };
  }
  if (isSocial(normalized)) {
    return { interactionIntent: "social", primaryText: value.trim(), boundaryReason: null, supersedesStaleWork: false, retrievalSkipped: true };
  }
  if (isAcknowledgement(normalized)) {
    return { interactionIntent: "acknowledgement", primaryText: value.trim(), boundaryReason: null, supersedesStaleWork: false, retrievalSkipped: true };
  }
  if (ROLL_CALL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { interactionIntent: "roll_call", primaryText: value.trim(), boundaryReason: "roll_call_new_boundary", supersedesStaleWork: false, retrievalSkipped: true };
  }
  if (EXPLICIT_ALL_AGENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { interactionIntent: "explicit_all_agents", primaryText: value.trim(), boundaryReason: null, supersedesStaleWork: false, retrievalSkipped: false };
  }
  if (isNudge(normalized)) {
    return { interactionIntent: "nudge", primaryText: value.trim(), boundaryReason: "explicit_continuation", supersedesStaleWork: false, retrievalSkipped: false };
  }
  return { interactionIntent: "substantive", primaryText: value.trim(), boundaryReason: null, supersedesStaleWork: false, retrievalSkipped: false };
}

export function isLightweightInteractionIntent(intent: ConversationInteractionIntent): boolean {
  return intent === "social" || intent === "acknowledgement" || intent === "correction" || intent === "topic_reset";
}

export function isSupersedingInteractionIntent(intent: ConversationInteractionIntent): boolean {
  return intent === "social" || intent === "acknowledgement" || intent === "correction" || intent === "topic_reset";
}

export interface ThreadContinuationInput {
  readonly candidateThread: ThreadRecord | null;
  readonly recentMessages: readonly MessageRecord[];
  readonly text: string;
  readonly now: string;
  readonly hasExplicitAgentAddress?: boolean;
  readonly hasDirectReply?: boolean;
  readonly hasTopicBinding?: boolean;
}

export interface ThreadContinuationDecision {
  readonly continueThread: boolean;
  readonly classification: ConversationClassification;
  readonly reason: ConversationBoundaryReason;
}

function hoursSince(now: string, earlier: string | null): number {
  if (!earlier) return Number.POSITIVE_INFINITY;
  const value = Date.parse(now) - Date.parse(earlier);
  return Number.isFinite(value) ? Math.max(0, value / 3_600_000) : Number.POSITIVE_INFINITY;
}

function termOverlap(left: string, right: string): number {
  const a = new Set(keyTerms(left));
  const b = new Set(keyTerms(right));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return shared / Math.max(1, Math.min(a.size, b.size));
}

export function decideThreadContinuation(input: ThreadContinuationInput): ThreadContinuationDecision {
  const classification = classifyConversationIntent(input.text);
  if (!input.candidateThread) {
    return { continueThread: false, classification, reason: "no_active_thread" };
  }
  if (input.hasDirectReply) {
    return { continueThread: true, classification: { ...classification, boundaryReason: "explicit_telegram_reply" }, reason: "explicit_telegram_reply" };
  }
  if (input.hasTopicBinding) {
    return { continueThread: true, classification: { ...classification, boundaryReason: "telegram_topic_binding" }, reason: "telegram_topic_binding" };
  }

  const age = hoursSince(input.now, input.candidateThread.lastActivityAt);
  const recentHuman = [...input.recentMessages].reverse().find(isHuman);
  const recentIntent = recentHuman ? classifyConversationIntent(recentHuman.contentText).interactionIntent : null;
  const recentLightweight = recentIntent === "social" || recentIntent === "acknowledgement" || recentIntent === "correction" || recentIntent === "topic_reset";
  if (classification.interactionIntent === "social") {
    return age <= 0.5 && recentLightweight
      ? { continueThread: true, classification: { ...classification, boundaryReason: "recent_social_thread" }, reason: "recent_social_thread" }
      : { continueThread: false, classification: { ...classification, boundaryReason: "social_new_boundary" }, reason: "social_new_boundary" };
  }
  if (classification.interactionIntent === "acknowledgement") {
    return age <= 0.5 && recentLightweight
      ? { continueThread: true, classification: { ...classification, boundaryReason: "recent_social_thread" }, reason: "recent_social_thread" }
      : { continueThread: false, classification: { ...classification, boundaryReason: "acknowledgement_new_boundary" }, reason: "acknowledgement_new_boundary" };
  }
  if (classification.interactionIntent === "correction" || classification.interactionIntent === "topic_reset") {
    return age <= 6
      ? { continueThread: true, classification, reason: classification.boundaryReason ?? "correction_supersedes_active_thread" }
      : { continueThread: false, classification, reason: classification.boundaryReason ?? "topic_reset_new_boundary" };
  }
  if (classification.interactionIntent === "roll_call") {
    return { continueThread: false, classification, reason: "roll_call_new_boundary" };
  }
  if (classification.interactionIntent === "nudge") {
    return age <= 24
      ? { continueThread: true, classification, reason: "explicit_continuation" }
      : { continueThread: false, classification: { ...classification, boundaryReason: "ambiguous_temporal_gap" }, reason: "ambiguous_temporal_gap" };
  }

  const recentSubstantiveHuman = [...input.recentMessages].reverse().find(isSubstantiveHuman);
  const overlap = recentSubstantiveHuman ? termOverlap(input.text, recentSubstantiveHuman.contentText) : 0;
  if (age <= 2 && overlap >= 0.34) {
    return { continueThread: true, classification: { ...classification, boundaryReason: "recent_semantic_continuity" }, reason: "recent_semantic_continuity" };
  }
  if (input.hasExplicitAgentAddress && age <= 24) {
    return { continueThread: true, classification: { ...classification, boundaryReason: "explicit_continuation" }, reason: "explicit_continuation" };
  }
  return { continueThread: false, classification: { ...classification, boundaryReason: "ambiguous_temporal_gap" }, reason: "ambiguous_temporal_gap" };
}

export function buildConversationFocus(input: ConversationFocusInput): ConversationFocus {
  const messages = uniqueMessages(input);
  const humanMessages = messages.filter(isHuman);
  const latestHuman = humanMessages.at(-1) ?? null;
  const classification = latestHuman
    ? classifyConversationIntent(latestHuman.contentText)
    : { interactionIntent: "substantive" as const, primaryText: "", boundaryReason: null, supersedesStaleWork: false, retrievalSkipped: false };
  const substantiveHuman = [...humanMessages].reverse().find(isSubstantiveHuman) ?? null;
  const attachment = latestHuman?.metadata?.attachment;
  const currentImagePresent = input.currentImagePresent === true
    || (typeof attachment === "object" && attachment !== null && !Array.isArray(attachment) && (attachment as { readonly type?: unknown }).type === "image");
  const primary = (classification.interactionIntent === "nudge" ? substantiveHuman?.contentText : latestHuman?.contentText)?.trim()
    || (currentImagePresent ? "image attachment" : undefined)
    || input.thread.summary?.trim()
    || input.thread.title.trim();
  const boundaryAt = latestHuman?.createdAt ?? input.wakeMessage?.createdAt ?? null;
  const currentMessages = messageAtOrAfter(messages, boundaryAt);
  const latestAgent = [...currentMessages].reverse().find((message) => message.authorType === "agent") ?? null;
  const lightweight = isLightweightInteractionIntent(classification.interactionIntent);
  const recentDevelopment = lightweight || classification.interactionIntent === "roll_call"
    ? null
    : latestAgent?.contentText.trim() ?? null;
  const unresolvedQuestion = classification.interactionIntent === "nudge"
    ? substantiveHuman?.contentText.trim() ?? null
    : classification.interactionIntent === "social" || classification.interactionIntent === "acknowledgement" || classification.interactionIntent === "correction" || classification.interactionIntent === "topic_reset"
      ? null
      : latestHuman?.contentText.trim() ?? null;
  const focusText = [primary, recentDevelopment, unresolvedQuestion].filter((value): value is string => Boolean(value)).join("\n");
  const normalizedFocus = normalizeConversationText(focusText);
  const broad = !lightweight && BROAD_PATTERNS.some((pattern) => pattern.test(normalizedFocus));
  const current = !lightweight && CURRENT_PATTERNS.some((pattern) => pattern.test(normalizedFocus));
  const objective = input.thread.summary?.trim() || input.thread.title.trim();
  const selectionQuery = lightweight
    ? cap(primary, 900)
    : cap([primary, recentDevelopment].filter((value): value is string => Boolean(value)).join("\n"), 1_200);
  const retrievalQuery = classification.retrievalSkipped || currentImagePresent && normalizeConversationText(primary).includes("image attachment")
    ? ""
    : cap([primary, unresolvedQuestion, recentDevelopment].filter((value): value is string => Boolean(value)).join("\n"), 1_600);

  return {
    primaryQuery: cap(primary, 900),
    latestHumanMessage: latestHuman?.contentText ?? null,
    latestHumanMessageAt: latestHuman?.createdAt ?? null,
    interactionIntent: classification.interactionIntent,
    boundaryReason: classification.boundaryReason,
    currentBoundaryAt: boundaryAt,
    retrievalSkippedReason: classification.retrievalSkipped ? `interaction_intent:${classification.interactionIntent}` : null,
    threadObjective: cap(objective, 500),
    recentDevelopment: recentDevelopment ? cap(recentDevelopment, 800) : null,
    unresolvedQuestion: unresolvedQuestion ? cap(unresolvedQuestion, 800) : null,
    keyTerms: keyTerms(focusText),
    selectionQuery,
    retrievalQuery,
    isBroadQuestion: broad,
    isCurrentStateQuestion: current,
    currentImagePresent,
  };
}

export function isConversationalNudge(value: string): boolean {
  return classifyConversationIntent(value).interactionIntent === "nudge";
}
