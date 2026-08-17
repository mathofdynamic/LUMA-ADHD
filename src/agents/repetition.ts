import { FOUNDATION_GUARDRAILS } from "../guardrails";

function normalizedTokens(value: string): readonly string[] {
  return value
    .replace(/<[^>]*>/gu, " ")
    .normalize("NFKC")
    .replace(/[يى]/gu, "ی")
    .replace(/[ك]/gu, "ک")
    .replace(/[\u200c\u200d\u200e\u200f]/gu, "")
    .replace(/ارزش\s+(?:اولیه|اول)/gu, "firstvalue")
    .replace(/اول(?:ین|یه)/gu, "firstvalue")
    .replace(/فعال\s*سازی/gu, "activation")
    .replace(/فعالسازی/gu, "activation")
    .replace(/(?:روشن|واضح|clear)/giu, "clear")
    .replace(/(?:افت|پایین|کاهش|decline)/giu, "decline")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

const NON_DISTINCTIVE_TERMS = new Set([
  "لوما", "luma", "است", "هست", "چی", "چیست", "برای", "یک", "و", "در", "به", "از", "با", "را", "که", "این", "آن", "من", "ما", "شما",
  "the", "is", "are", "a", "an", "and", "for", "in", "to", "of", "with", "what", "does", "we", "our", "it", "this", "that",
]);

export interface ContributionDuplicationAssessment {
  readonly duplicate: boolean;
  readonly similarity: number;
  readonly sharedTerms: readonly string[];
  readonly reason: "exact" | "near_exact" | "semantic_overlap" | "distinct";
}

function distinctiveTokens(value: string): readonly string[] {
  return [...new Set(normalizedTokens(value).filter((token) => token.length >= 3 && !NON_DISTINCTIVE_TERMS.has(token)))];
}

/**
 * Bounded same-burst duplication detection. This is deliberately lexical,
 * not a claim of semantic understanding: it catches differently worded
 * restatements when they retain the same distinctive concepts.
 */
export function assessContributionDuplication(
  candidate: string,
  previous: readonly string[],
): ContributionDuplicationAssessment {
  const candidateKey = repetitionKey(candidate);
  const candidateTerms = distinctiveTokens(candidate);
  if (candidateKey.length === 0 || candidateTerms.length < 4) {
    return { duplicate: false, similarity: 0, sharedTerms: [], reason: "distinct" };
  }

  let best: ContributionDuplicationAssessment = { duplicate: false, similarity: 0, sharedTerms: [], reason: "distinct" };
  for (const value of previous.slice(-6)) {
    const previousKey = repetitionKey(value);
    if (!previousKey) continue;
    if (previousKey === candidateKey) {
      return { duplicate: true, similarity: 1, sharedTerms: candidateTerms.slice(0, 12), reason: "exact" };
    }
    const previousTerms = distinctiveTokens(value);
    if (previousTerms.length < 4) continue;
    const previousSet = new Set(previousTerms);
    const sharedTerms = candidateTerms.filter((term) => previousSet.has(term));
    const unionSize = new Set([...candidateTerms, ...previousTerms]).size;
    const jaccard = unionSize === 0 ? 0 : sharedTerms.length / unionSize;
    const containment = Math.min(sharedTerms.length / candidateTerms.length, sharedTerms.length / previousTerms.length);
    const similarity = Math.max(jaccard, containment);
    const duplicate = sharedTerms.length >= 4 && (jaccard >= 0.58 || containment >= 0.68);
    if (similarity > best.similarity) {
      best = {
        duplicate,
        similarity,
        sharedTerms: sharedTerms.slice(0, 12),
        reason: duplicate ? "semantic_overlap" : "distinct",
      };
    }
  }
  return best;
}

export function repetitionKey(value: string): string {
  return normalizedTokens(value).join(" ");
}

/**
 * Cheap, deterministic burst protection. It intentionally ignores short
 * identifiers and does not attempt semantic similarity.
 */
export function isObviousRepeatedContent(
  candidate: string,
  previous: readonly string[],
  minimumCharacters = FOUNDATION_GUARDRAILS.repeatedContentMinimumCharacters,
): boolean {
  if (Array.from(candidate).length < minimumCharacters) return false;
  const candidateKey = repetitionKey(candidate);
  if (candidateKey.length === 0) return false;
  const candidateTokens = new Set(candidateKey.split(" "));
  for (const value of previous) {
    if (Array.from(value).length < minimumCharacters) continue;
    const previousKey = repetitionKey(value);
    if (previousKey === candidateKey) return true;
    const previousTokens = new Set(previousKey.split(" "));
    const union = new Set([...candidateTokens, ...previousTokens]);
    const intersection = [...candidateTokens].filter((token) => previousTokens.has(token)).length;
    if (union.size >= 8 && intersection / union.size >= 0.92) return true;
  }
  return false;
}
