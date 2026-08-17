import { FOUNDATION_GUARDRAILS } from "../guardrails";

function normalizedTokens(value: string): readonly string[] {
  return value
    .replace(/<[^>]*>/gu, " ")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
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
