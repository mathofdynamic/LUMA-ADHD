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
