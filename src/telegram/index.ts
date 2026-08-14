export interface TelegramUpdateEnvelope {
  readonly botAlias: string;
  readonly receivedAt: string;
  readonly payload: unknown;
}

export function webhookPath(botAlias: string): string {
  if (!/^[a-z0-9-]+$/.test(botAlias)) {
    throw new Error("botAlias must contain lowercase letters, numbers, or hyphens");
  }

  return `/telegram/webhook/${botAlias}`;
}
