import type { MessageRecord, ThreadRecord } from "../database/types";

export type ConversationInteractionIntent = "substantive" | "nudge";

export interface ConversationFocusInput {
  readonly thread: ThreadRecord;
  readonly wakeMessage: MessageRecord | null;
  readonly anchorMessage?: MessageRecord | null;
  readonly recentMessages: readonly MessageRecord[];
}

export interface ConversationFocus {
  readonly primaryQuery: string;
  readonly latestHumanMessage: string | null;
  readonly latestHumanMessageAt: string | null;
  readonly interactionIntent: ConversationInteractionIntent;
  readonly threadObjective: string;
  readonly recentDevelopment: string | null;
  readonly unresolvedQuestion: string | null;
  readonly keyTerms: readonly string[];
  readonly selectionQuery: string;
  readonly retrievalQuery: string;
  readonly isBroadQuestion: boolean;
  readonly isCurrentStateQuestion: boolean;
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
  /فعلی/u,
  /الان/u,
  /امروز/u,
  /در\s+حال\s+حاضر/u,
  /current/iu,
  /today/iu,
  /right\s+now/iu,
  /currently/iu,
];

const STOP_TERMS = new Set([
  "است", "هست", "چی", "چیست", "برای", "یک", "و", "در", "به", "از", "با", "را", "که", "این", "آن", "من", "ما", "شما", "بچه", "بچهها",
  "the", "is", "are", "a", "an", "and", "for", "in", "to", "of", "with", "what", "does", "please", "tell", "me", "we", "our",
]);

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[يى]/gu, "ی")
    .replace(/[ك]/gu, "ک")
    .replace(/[ۀة]/gu, "ه")
    .replace(/[\u200c\u200d\u200e\u200f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function isNudge(value: string): boolean {
  const normalized = normalize(value);
  return normalized.length < 90 && NUDGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isHuman(message: MessageRecord): boolean {
  return message.authorType === "human" || message.authorType === "system" && message.authorUserId !== null;
}

function uniqueMessages(input: ConversationFocusInput): readonly MessageRecord[] {
  const byId = new Map<string, MessageRecord>();
  for (const message of [...input.recentMessages, input.anchorMessage, input.wakeMessage]) {
    if (message) byId.set(message.id, message);
  }
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function keyTerms(value: string): readonly string[] {
  const terms = normalize(value).match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(terms.filter((term) => !STOP_TERMS.has(term)))].slice(0, 12);
}

function cap(value: string, characters: number): string {
  return Array.from(value).slice(0, characters).join("");
}

export function buildConversationFocus(input: ConversationFocusInput): ConversationFocus {
  const messages = uniqueMessages(input);
  const humanMessages = messages.filter(isHuman);
  const latestHuman = humanMessages.at(-1) ?? null;
  const latestHumanIsNudge = latestHuman ? isNudge(latestHuman.contentText) : false;
  const substantiveHuman = [...humanMessages].reverse().find((message) => !isNudge(message.contentText)) ?? null;
  const primary = substantiveHuman?.contentText.trim()
    || input.thread.summary?.trim()
    || input.thread.title.trim();
  const latestAgent = [...messages].reverse().find((message) => message.authorType === "agent") ?? null;
  const recentDevelopment = latestAgent?.contentText.trim() ?? null;
  const unresolvedQuestion = latestHumanIsNudge
    ? substantiveHuman?.contentText.trim() ?? null
    : latestHuman?.contentText.trim() ?? null;
  const focusText = [primary, recentDevelopment, unresolvedQuestion].filter((value): value is string => Boolean(value)).join("\n");
  const normalizedFocus = normalize(focusText);
  const broad = BROAD_PATTERNS.some((pattern) => pattern.test(normalizedFocus));
  const current = CURRENT_PATTERNS.some((pattern) => pattern.test(normalizedFocus));
  const intent: ConversationInteractionIntent = latestHumanIsNudge ? "nudge" : "substantive";
  const objective = input.thread.summary?.trim() || input.thread.title.trim();
  const selectionQuery = cap([primary, recentDevelopment].filter((value): value is string => Boolean(value)).join("\n"), 1_200);
  const retrievalQuery = cap([primary, unresolvedQuestion, recentDevelopment].filter((value): value is string => Boolean(value)).join("\n"), 1_600);

  return {
    primaryQuery: cap(primary, 900),
    latestHumanMessage: latestHuman?.contentText ?? null,
    latestHumanMessageAt: latestHuman?.createdAt ?? null,
    interactionIntent: intent,
    threadObjective: cap(objective, 500),
    recentDevelopment: recentDevelopment ? cap(recentDevelopment, 800) : null,
    unresolvedQuestion: unresolvedQuestion ? cap(unresolvedQuestion, 800) : null,
    keyTerms: keyTerms(focusText),
    selectionQuery,
    retrievalQuery,
    isBroadQuestion: broad,
    isCurrentStateQuestion: current,
  };
}

export function isConversationalNudge(value: string): boolean {
  return isNudge(value);
}
