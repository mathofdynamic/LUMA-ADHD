import { normalizeFtsQuery } from "../memory/retrieval";
import type { ContextPack } from "../memory/types";

const NON_DISTINCTIVE_TERMS = new Set([
  "لوما", "luma", "است", "هست", "چی", "چیست", "دارد", "دارند", "برای", "یک", "و", "در", "به", "از", "با", "را", "که", "این", "آن",
  "the", "is", "are", "a", "an", "and", "for", "in", "to", "of", "with", "what", "does",
]);

export interface OfficialGroundingAssessment {
  readonly required: boolean;
  readonly satisfied: boolean;
  readonly sourceIds: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly bestSourceMatchCount: number;
}

export interface CurrentStateGroundingAssessment {
  readonly claimDetected: boolean;
  readonly supported: boolean;
  readonly evidenceKinds: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly proposalOnly: boolean;
  readonly state: "not_applicable" | "supported" | "qualified" | "unsupported";
}

const STRONG_CURRENT_CLAIM_PATTERNS: readonly RegExp[] = [
  /سه\s+مشکل\s+(?:اصلی|بزرگ|مهم)/u,
  /مهم[‌ ]ترین\s+(?:مشکل|مسئله|اولویت)/u,
  /بزرگ[‌ ]ترین\s+(?:مشکل|مسئله)/u,
  /اولویت\s+(?:اول|اصلی)/u,
  /top\s+(?:three|3|priority|problem)/iu,
  /(?:the|our)\s+(?:main|biggest|most important)\s+(?:problem|priority)/iu,
];

const PROPOSAL_MARKERS: readonly RegExp[] = [
  /پیشنهاد/u,
  /آینده/u,
  /سناریو/u,
  /نیازمند\s+اعتبارسنجی/u,
  /باید\s+اعتبارسنجی\s+شود/u,
  /برنامه\s+(?:داخلی|آتی)/u,
  /proposal/iu,
  /future\s+(?:plan|model)/iu,
  /validate|validation\s+(?:needed|required)/iu,
  /not\s+(?:current|live)/iu,
];

const CURRENT_EVIDENCE_TYPES = new Set(["decision", "memory_note"]);
const OBSERVED_SIGNAL_MARKERS: readonly RegExp[] = [
  /داده/u,
  /اندازه[‌ ]گیری/u,
  /گزارش/u,
  /نرخ/u,
  /مشاهده/u,
  /observed/iu,
  /measured/iu,
  /analytics/iu,
  /conversion/iu,
  /retention/iu,
];

function termsFor(value: string): readonly string[] {
  return normalizeFtsQuery(value)
    .map((term) => term.toLocaleLowerCase())
    .filter((term) => term.length >= 3 && !NON_DISTINCTIVE_TERMS.has(term));
}

export function assessOfficialGrounding(content: string, contextPack: ContextPack): OfficialGroundingAssessment {
  const required = (contextPack.telemetry.queryIntent === "official_factual" || contextPack.telemetry.queryIntent === "mixed")
    && contextPack.telemetry.officialKnowledgeCount > 0;
  const official = contextPack.items.filter((item) => item.type === "knowledge_chunk");
  const sourceIds = official.map((item) => item.sourceId);
  if (!required || official.length === 0) {
    return { required, satisfied: !required, sourceIds, matchedTerms: [], bestSourceMatchCount: 0 };
  }

  const contentTerms = new Set(termsFor(content));
  const matchedTerms = [...new Set(official.flatMap((item) => termsFor(item.excerpt).filter((term) => contentTerms.has(term))))];
  const bestSourceMatchCount = Math.max(
    0,
    ...official.map((item) => termsFor(item.excerpt).filter((term) => contentTerms.has(term)).length),
  );

  // A factual answer must carry at least two distinctive terms from one
  // retrieved official excerpt. If it cannot, give the model one bounded
  // repair opportunity instead of silently presenting generic model memory.
  return {
    required,
    satisfied: bestSourceMatchCount >= 2,
    sourceIds,
    matchedTerms: matchedTerms.slice(0, 12),
    bestSourceMatchCount,
  };
}

/**
 * Current-state language needs a stronger bar than ordinary brainstorming.
 * A future plan can support a hypothesis, but cannot establish today's top
 * problem or priority by itself.
 */
export function assessCurrentStateGrounding(content: string, contextPack: ContextPack): CurrentStateGroundingAssessment {
  const normalizedContent = normalizeFtsQuery(content).join(" ").toLocaleLowerCase();
  const claimDetected = STRONG_CURRENT_CLAIM_PATTERNS.some((pattern) => pattern.test(normalizedContent));
  if (!claimDetected) {
    return { claimDetected: false, supported: true, evidenceKinds: [], matchedTerms: [], proposalOnly: false, state: "not_applicable" };
  }

  const evidenceKinds = [...new Set(contextPack.items.map((item) => item.type))];
  const proposalItems = contextPack.items.filter((item) => PROPOSAL_MARKERS.some((pattern) => pattern.test(normalizeFtsQuery(item.excerpt).join(" "))));
  const currentEvidenceItems = contextPack.items.filter((item) =>
    CURRENT_EVIDENCE_TYPES.has(item.type)
    || ((item.type === "message" || item.type === "thread_summary") && OBSERVED_SIGNAL_MARKERS.some((pattern) => pattern.test(normalizeFtsQuery(item.excerpt).join(" ")))),
  );
  const proposalOnly = proposalItems.length > 0 && currentEvidenceItems.length === 0;
  const contentTerms = new Set(termsFor(content));
  const matchedTerms = [...new Set(contextPack.items.flatMap((item) => termsFor(item.excerpt).filter((term) => contentTerms.has(term))))].slice(0, 12);
  const supported = currentEvidenceItems.length > 0 && !proposalOnly && matchedTerms.length >= 2;
  return {
    claimDetected: true,
    supported,
    evidenceKinds,
    matchedTerms,
    proposalOnly,
    state: supported ? "supported" : proposalOnly ? "unsupported" : "qualified",
  };
}

export function qualifyUnsupportedCurrentClaim(
  content: string,
  assessment: CurrentStateGroundingAssessment,
): string {
  if (!assessment.claimDetected || assessment.supported || assessment.state === "not_applicable") return content;
  const qualified = content
    .replace(/سه\s+مشکل\s+(?:اصلی|بزرگ|مهم)/gu, "سه فرضیه قابل‌بررسی")
    .replace(/مهم[‌ ]ترین\s+(?:مشکل|مسئله|اولویت)/gu, "یکی از اولویت‌های قابل‌بررسی")
    .replace(/بزرگ[‌ ]ترین\s+(?:مشکل|مسئله)/gu, "یکی از مسائل قابل‌بررسی")
    .replace(/اولویت\s+(?:اول|اصلی)/gu, "اولویت احتمالی")
    .replace(/top\s+(?:three|3|priority|problem)/giu, "candidate hypotheses, not a proven ranking")
    .replace(/(?:the|our)\s+(?:main|biggest|most important)\s+(?:problem|priority)/giu, "a candidate problem, not an established current priority");
  const prefix = /[\u0600-\u06ff]/u.test(content)
    ? "در داده‌های فعلی، این رتبه‌بندی اثبات نشده است؛ موارد زیر فرضیه‌های قابل‌بررسی‌اند، نه واقعیت قطعی:\n"
    : "The available evidence does not establish this ranking; these are hypotheses to validate, not confirmed current priorities:\n";
  return `${prefix}${qualified}`;
}
