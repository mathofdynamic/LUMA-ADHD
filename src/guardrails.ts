/** Central Phase 00 safety and cost defaults. Later phases may override these
 * only through an explicit, validated configuration path. */
export const FOUNDATION_GUARDRAILS = Object.freeze({
  interactiveBurstMaxTurns: 6,
  deepWorkMaxTurns: 12,
  queueChainMaxDepth: 3,
  schedulerWorkPerTick: 3,
  maxRetries: 3,
  telegramMessageMaxCharacters: 4096,
} as const);

export type FoundationGuardrails = typeof FOUNDATION_GUARDRAILS;

export function splitTelegramMessage(
  message: string,
  maxCharacters: number = FOUNDATION_GUARDRAILS.telegramMessageMaxCharacters,
): string[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error("maxCharacters must be a positive integer");
  }

  if (message.length <= maxCharacters) {
    return [message];
  }

  const chunks: string[] = [];
  let remaining = message;

  while (remaining.length > maxCharacters) {
    let cutAt = maxCharacters;
    const lineBreak = remaining.lastIndexOf("\n", maxCharacters);

    if (lineBreak > 0) {
      cutAt = lineBreak;
    }

    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
