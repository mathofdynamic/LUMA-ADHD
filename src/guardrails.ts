/** Central safety and cost defaults. Later phases may override these
 * only through an explicit, validated configuration path. */
export const FOUNDATION_GUARDRAILS = Object.freeze({
  interactiveBurstMaxTurns: 6,
  deepWorkMaxTurns: 12,
  queueChainMaxDepth: 3,
  acquisitionMaxOperations: 3,
  schedulerWorkPerTick: 3,
  maxRetries: 3,
  providerMaxAttempts: 2,
  providerTimeoutMilliseconds: 28_000,
  godProviderTimeoutMilliseconds: 120_000,
  godReviewMaxOutputTokens: 6_000,
  maxStructuredRepairAttempts: 1,
  recentContextMessageLimit: 12,
  maxAgentActionContentCharacters: 12_000,
  ambientOpportunityIntervalMinutes: 240,
  inactivityRecoveryHours: 6,
  telegramMessageMaxCharacters: 4096,
  // These are LUMA internal safety budgets, not Cloudflare quota claims.
  ambientDailyJobBudget: 24,
  deepWorkDailyJobBudget: 24,
  godDailyReviewBudget: 2,
  knowledgeDailySyncBudget: 12,
  reputationDailyJobBudget: 2,
  repeatedContentMinimumCharacters: 32,
} as const);

export type FoundationGuardrails = typeof FOUNDATION_GUARDRAILS;

export function splitTelegramMessage(
  message: string,
  maxCharacters: number = FOUNDATION_GUARDRAILS.telegramMessageMaxCharacters,
): string[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error("maxCharacters must be a positive integer");
  }

  const codePoints = Array.from(message);
  if (codePoints.length <= maxCharacters) {
    return [message];
  }

  const chunks: string[] = [];
  let start = 0;

  while (codePoints.length - start > maxCharacters) {
    let cutAt = maxCharacters;
    const candidate = codePoints.slice(start, start + maxCharacters);
    const lineBreak = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf("\r"));

    if (lineBreak > 0) {
      cutAt = lineBreak + 1;
    } else {
      const whitespace = Math.max(candidate.lastIndexOf(" "), candidate.lastIndexOf("\t"));
      if (whitespace > 0) {
        cutAt = whitespace + 1;
      }
    }

    chunks.push(codePoints.slice(start, start + cutAt).join(""));
    start += cutAt;
  }

  if (start < codePoints.length) {
    chunks.push(codePoints.slice(start).join(""));
  }

  return chunks;
}
