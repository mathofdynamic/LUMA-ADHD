import { splitTelegramMessage } from "../guardrails";

export const TELEGRAM_PARSE_MODE = "HTML" as const;

export function escapeTelegramHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderTelegramText(text: string): readonly string[] {
  return splitTelegramMessage(text).map(escapeTelegramHtml);
}
