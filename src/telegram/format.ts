import { splitTelegramMessage } from "../guardrails";
import type { TelegramContentFormat } from "./types";

export const TELEGRAM_PARSE_MODE = "HTML" as const;

type CanonicalTagName = "b" | "i" | "u" | "s" | "code" | "pre" | "blockquote" | "a" | "tg-spoiler";

interface OpenTag {
  readonly name: CanonicalTagName;
  readonly opening: string;
  readonly closing: string;
}

interface ParsedTag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attributes: string;
}

interface SanitizedHtml {
  readonly html: string;
  readonly valid: boolean;
}

const TAG_PATTERN = /^<\s*(\/?)\s*([a-z][a-z0-9-]*)([\s\S]*?)(\/?)>$/iu;
const TOKEN_PATTERN = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+|</gu;
const CANONICAL_TAGS = new Set<CanonicalTagName>([
  "b",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "a",
  "tg-spoiler",
]);
const TAG_ALIASES: Readonly<Record<string, CanonicalTagName>> = {
  strong: "b",
  em: "i",
  ins: "u",
  strike: "s",
  del: "s",
};

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function stripMarkdownSyntax(value: string): string {
  return value
    .replace(/(^|\n)[ \t]{0,3}#{1,6}[ \t]+/gu, "$1")
    .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
    .replace(/__([^_\n]+)__/gu, "$1")
    .replace(/(^|\n)[ \t]*\*[ \t]+/gu, "$1• ")
    .replace(/`([^`\n]+)`/gu, "$1");
}

function escapeHtmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replaceAll('"', "&quot;");
}

function safeHref(value: string): boolean {
  return /^(?:https?:\/\/|tg:\/\/user\?id=)[^\s<>"']+$/iu.test(value);
}

function parseTag(token: string): ParsedTag | null {
  const match = token.match(TAG_PATTERN);
  if (!match) return null;

  return {
    name: match[2].toLowerCase(),
    closing: match[1].length > 0,
    selfClosing: match[4].length > 0,
    attributes: match[3].trim(),
  };
}

function canonicalTagName(name: string): CanonicalTagName | null {
  if (CANONICAL_TAGS.has(name as CanonicalTagName)) {
    return name as CanonicalTagName;
  }
  return TAG_ALIASES[name] ?? null;
}

function openingTag(name: CanonicalTagName, attributes: string): string | null {
  if (attributes.length === 0) {
    return `<${name}>`;
  }

  if (name === "blockquote" && /^expandable$/iu.test(attributes)) {
    return "<blockquote expandable>";
  }

  if (name !== "a") return null;
  const hrefMatch = attributes.match(/^href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))$/iu);
  const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];
  if (!href || !safeHref(href)) return null;
  return `<a href="${escapeHtmlAttribute(href)}">`;
}

function stripTagsForPlainText(text: string): string {
  return text.replace(/<\/?[A-Za-z][^>]*>/gu, "");
}

function sanitizeTelegramHtml(text: string): SanitizedHtml {
  const stack: OpenTag[] = [];
  let html = "";
  let valid = true;

  for (const token of text.matchAll(TOKEN_PATTERN)) {
    const value = token[0];
    if (!value.startsWith("<")) {
      const insideCode = stack.some((item) => item.name === "code" || item.name === "pre");
      html += escapeHtmlText(insideCode ? value : stripMarkdownSyntax(value));
      continue;
    }

    if (value.startsWith("<!--")) continue;
    if (value === "<") {
      valid = false;
      html += escapeHtmlText(value);
      continue;
    }

    const parsed = parseTag(value);
    if (!parsed) {
      valid = false;
      html += escapeHtmlText(value);
      continue;
    }

    if (parsed.name === "br" && !parsed.closing && (parsed.attributes.length === 0 || parsed.selfClosing)) {
      html += "\n";
      continue;
    }

    const name = canonicalTagName(parsed.name);
    if (!name) {
      // Unsupported tags are removed while their text remains visible.
      // This prevents model-generated markup from reaching Telegram.
      continue;
    }

    if (parsed.closing) {
      if (parsed.selfClosing || stack.at(-1)?.name !== name) {
        valid = false;
        continue;
      }
      stack.pop();
      html += `</${name}>`;
      continue;
    }

    if (parsed.selfClosing) {
      valid = false;
      continue;
    }

    const opening = openingTag(name, parsed.attributes);
    if (!opening) {
      continue;
    }
    const tag: OpenTag = { name, opening, closing: `</${name}>` };
    stack.push(tag);
    html += opening;
  }

  if (stack.length > 0) valid = false;
  return { html, valid };
}

function splitTelegramHtml(text: string, maxCharacters: number): readonly string[] {
  if (codePointLength(text) <= maxCharacters) return [text];

  const parts: string[] = [];
  const stack: OpenTag[] = [];
  let current = "";
  let hasText = false;

  const closeTags = (): string => stack.slice().reverse().map((tag) => tag.closing).join("");
  const reopenTags = (): string => stack.map((tag) => tag.opening).join("");
  const flush = (): void => {
    if (!hasText) return;
    current += closeTags();
    parts.push(current);
    current = reopenTags();
    hasText = false;
  };

  for (const token of text.matchAll(TOKEN_PATTERN)) {
    const value = token[0];
    if (value.startsWith("<") && value !== "<") {
      const parsed = parseTag(value);
      const name = parsed ? canonicalTagName(parsed.name) : null;
      if (!parsed || !name || parsed.name === "br") {
        current += value;
        continue;
      }

      if (parsed.closing) {
        current += `</${name}>`;
        stack.pop();
        continue;
      }

      const opening = openingTag(name, parsed.attributes) ?? `<${name}>`;
      const prospectiveLength = codePointLength(current) + codePointLength(opening) + codePointLength(closeTags());
      if (hasText && prospectiveLength > maxCharacters) flush();
      current += opening;
      stack.push({ name, opening, closing: `</${name}>` });
      continue;
    }

    let remaining = value;
    while (remaining.length > 0) {
      const available = maxCharacters - codePointLength(current) - codePointLength(closeTags());
      if (available <= 0) {
        flush();
        if (available <= 0 && !hasText && codePointLength(current) >= maxCharacters) {
          // This only occurs for an unusually large tag. Keep the tag intact
          // rather than creating an empty part or splitting its delimiter.
          current = "";
        }
        continue;
      }

      const codePoints = Array.from(remaining);
      let take = Math.min(available, codePoints.length);
      if (take < codePoints.length) {
        const candidate = codePoints.slice(0, take).join("");
        const breakAt = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf(" "), candidate.lastIndexOf("\t"));
        if (breakAt > Math.floor(take / 2)) take = breakAt + 1;
      }

      const chunk = codePoints.slice(0, take).join("");
      current += chunk;
      hasText = hasText || chunk.length > 0;
      remaining = codePoints.slice(take).join("");
      if (remaining.length > 0) flush();
    }
  }

  if (hasText) flush();
  return parts.length > 0 ? parts : [text];
}

export function escapeTelegramHtml(text: string): string {
  return escapeHtmlText(text);
}

export function renderTelegramText(
  text: string,
  contentFormat: TelegramContentFormat = "plain_text",
): readonly string[] {
  if (contentFormat === "plain_text") {
    return splitTelegramMessage(escapeTelegramHtml(stripMarkdownSyntax(text)));
  }

  const sanitized = sanitizeTelegramHtml(text);
  if (!sanitized.valid) {
    const fallback = stripMarkdownSyntax(stripTagsForPlainText(text));
    return splitTelegramMessage(escapeTelegramHtml(fallback));
  }

  return splitTelegramHtml(sanitized.html, 4096);
}
