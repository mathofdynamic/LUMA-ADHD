export interface MarkdownChunkDraft {
  readonly ordinal: number;
  readonly heading: string | null;
  readonly headingPath: string | null;
  readonly contentText: string;
}

export function normalizeMarkdown(input: string): string {
  return input
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/gu, ""))
    .join("\n")
    .trim();
}

export function markdownTitle(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  return heading || fallback;
}

interface Section {
  readonly heading: string | null;
  readonly level: number;
  readonly headingPath: string | null;
  readonly body: string;
}

function sections(markdown: string): readonly Section[] {
  const lines = markdown.split("\n");
  const result: Section[] = [];
  const stack: string[] = [];
  let currentHeading: string | null = null;
  let currentLevel = 0;
  let currentBody: string[] = [];

  const flush = (): void => {
    const body = currentBody.join("\n").trim();
    if (body || currentHeading) {
      result.push({
        heading: currentHeading,
        level: currentLevel,
        headingPath: stack.length > 0 ? stack.join(" > ") : null,
        body,
      });
    }
    currentBody = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (!match) {
      currentBody.push(line);
      continue;
    }
    flush();
    currentLevel = match[1].length;
    currentHeading = match[2].trim();
    stack.splice(currentLevel - 1);
    stack.push(currentHeading);
  }
  flush();
  return result;
}

function splitLargeText(text: string, maxCharacters: number): readonly string[] {
  if (text.length <= maxCharacters) return [text];
  const paragraphs = text.split(/\n{2,}/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const pieces: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current) pieces.push(current);
    current = "";
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      flush();
      for (let index = 0; index < paragraph.length; index += maxCharacters) {
        pieces.push(paragraph.slice(index, index + maxCharacters));
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxCharacters) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  flush();
  return pieces;
}

export function chunkMarkdown(markdown: string, maxCharacters = 2_800): readonly MarkdownChunkDraft[] {
  const normalized = normalizeMarkdown(markdown);
  const result: MarkdownChunkDraft[] = [];
  for (const section of sections(normalized)) {
    const headingPrefix = section.heading ? `${"#".repeat(section.level)} ${section.heading}\n\n` : "";
    const body = section.body || section.heading || "";
    const bodyLimit = Math.max(500, maxCharacters - headingPrefix.length);
    for (const piece of splitLargeText(body, bodyLimit)) {
      const contentText = `${headingPrefix}${piece}`.trim();
      if (contentText.length === 0) continue;
      result.push({
        ordinal: result.length,
        heading: section.heading,
        headingPath: section.headingPath,
        contentText,
      });
    }
  }
  return result;
}
