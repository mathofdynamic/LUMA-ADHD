import type { KnowledgeApiRecord } from "./client";

export type VisualViewport = "desktop" | "mobile";
export type VisualProductConcept = "image_generation" | "video_generation" | "workflow" | "chat" | "image_editing";

export interface VisualQueryTarget {
  readonly visualIntent: boolean;
  readonly productConcept: VisualProductConcept | null;
  readonly canonicalPageIds: readonly string[];
  readonly canonicalRouteTokens: readonly string[];
  readonly viewport: VisualViewport | null;
  readonly uxIntent: boolean;
  readonly normalizedQuery: string;
}

export interface VisualMediaCandidate {
  readonly mediaId: string;
  readonly pageId: string | null;
  readonly route: string | null;
  readonly viewport: VisualViewport | null;
  readonly capturedAt: string | null;
  readonly contentHash: string | null;
  readonly score: number;
  readonly confidence: number;
  readonly signals: Readonly<Record<string, number>>;
}

export interface ResolvedVisualEvidence {
  readonly visualIntent: boolean;
  readonly target: VisualProductConcept | null;
  readonly viewport: VisualViewport | null;
  readonly candidates: readonly VisualMediaCandidate[];
  readonly selectedMediaId: string | null;
  readonly selectedPageId: string | null;
  readonly selectedRoute: string | null;
  readonly selectedViewport: VisualViewport | null;
  readonly selectedCapturedAt: string | null;
  readonly selectedContentHash: string | null;
  readonly delivered: boolean;
  readonly reSearchUsed: boolean;
  readonly selectionReason:
    | "canonical_page_match"
    | "metadata_match"
    | "live_research_match"
    | "below_confidence"
    | "no_candidate"
    | "not_visual";
}

interface VisualConceptDefinition {
  readonly concept: VisualProductConcept;
  readonly aliases: readonly RegExp[];
  readonly pageIds: readonly string[];
  readonly routeTokens: readonly string[];
}

const CONCEPTS: readonly VisualConceptDefinition[] = [
  {
    concept: "image_generation",
    aliases: [
      /(?:\u0633\u0627\u062e\u062a|\u062a\u0648\u0644\u06cc\u062f)\s+\u062a\u0635\u0648\u06cc\u0631/u,
      /image\s+(?:generation|generator)/iu,
      /generate\s+(?:an?\s+)?image/iu,
      /image\s+gen(?:eration|erator)?/iu,
    ],
    pageIds: ["public-image-generation", "image-generation", "dashboard-image-generation"],
    routeTokens: ["/service/img-gen", "/image-generation", "/image-generator"],
  },
  {
    concept: "video_generation",
    aliases: [
      /(?:\u0633\u0627\u062e\u062a|\u062a\u0648\u0644\u06cc\u062f)\s+\u0648\u06cc\u062f(?:\u06cc|\u0626)\u0648/u,
      /video\s+generation/iu,
      /video\s+generator/iu,
      /generate\s+(?:a\s+)?video/iu,
    ],
    pageIds: ["public-video", "video-generation", "dashboard-video-generation"],
    routeTokens: ["/service/video", "/video-generation", "/video-generator"],
  },
  {
    concept: "workflow",
    aliases: [
      /\bworkflow(?:\s+store)?\b/iu,
      /\u0648\u0631\u06a9\u200c?\u0641\u0644\u0648/u,
      /\u0641\u0631\u0648\u0634\u06af\u0627\u0647\s+\u0648\u0631\u06a9\u200c?\u0641\u0644\u0648/u,
    ],
    pageIds: ["dashboard-workflow-store", "public-workflow", "workflow-store"],
    routeTokens: ["/workflows/store", "/service/workflow", "/workflow"],
  },
  {
    concept: "chat",
    aliases: [
      /\bchat\b/iu,
      /\u0686\u062a/u,
    ],
    pageIds: ["public-chat", "chat"],
    routeTokens: ["/service/chat", "/chat"],
  },
  {
    concept: "image_editing",
    aliases: [
      /\u0648\u06cc\u0631\u0627\u06cc\u0634\s+\u062a\u0635\u0648\u06cc\u0631/u,
      /image\s+editing/iu,
      /edit(?:ing)?\s+(?:an?\s+)?image/iu,
    ],
    pageIds: ["public-image-editing", "image-editing"],
    routeTokens: ["/service/img-edit", "/image-editing"],
  },
];

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064a\u0649]/gu, "\u06cc")
    .replace(/[\u0643]/gu, "\u06a9")
    .replace(/[\u200c\u200d\u200e\u200f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function normalizeIdentifier(value: string | null): string {
  return normalizeText(value ?? "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/gu, "");
}

export function isUxIntentQuery(value: string): boolean {
  const query = normalizeText(value);
  if (/\b(?:ux|ui)\p{L}*/u.test(query)) return true;
  return /(?:\b(?:ux|ui|visual|interface|design)\p{L}*\b|\u0631\u0627\u0628\u0637\s+\u06a9\u0627\u0631\u0628\u0631\u06cc|\u062a\u062c\u0631\u0628\u0647\s+\u06a9\u0627\u0631\u0628\u0631\u06cc|\u0637\u0631\u0627\u062d\u06cc|\u0638\u0627\u0647\u0631|\u0686\u06cc\u062f\u0645\u0627\u0646|\u062f\u06cc\u0632\u0627\u06cc\u0646|\u0627\u06cc\u0631\u0627\u062f|\u0646\u0642\u062f)/u.test(query);
}

export function detectVisualViewport(value: string): VisualViewport | null {
  const query = normalizeText(value);
  if (/(?:\bmobile\b|\bphone\b|\bsmartphone\b|\u0645\u0648\u0628\u0627\u06cc\u0644|\u06af\u0648\u0634\u06cc)/u.test(query)) return "mobile";
  if (/(?:\bdesktop\b|\bweb\b|\u062f\u0633\u06a9\u062a\u0627\u067e)/u.test(query)) return "desktop";
  return null;
}

export function resolveVisualQuery(value: string): VisualQueryTarget {
  const normalizedQuery = normalizeText(value);
  const definition = CONCEPTS.find((item) => item.aliases.some((alias) => alias.test(normalizedQuery))) ?? null;
  const hasVisualLanguage = /(?:\b(?:screenshot|screen|page|ui|ux|visual|interface|design|appearance)\p{L}*\b|\blook(?:s)?\s+like\b|\u0635\u0641\u062d\u0647|\u0627\u0633\u06a9\u0631\u06cc\u0646|\u062a\u0635\u0648\u06cc\u0631|\u0638\u0627\u0647\u0631|\u0631\u0627\u0628\u0637|\u0634\u06a9\u0644)/u.test(normalizedQuery);
  return {
    // A product alias identifies the canonical concept, but it does not by
    // itself mean that the human asked for a screenshot. Keep ordinary factual
    // questions such as "What is Workflow?" on the text retrieval path.
    visualIntent: hasVisualLanguage,
    productConcept: definition?.concept ?? null,
    canonicalPageIds: definition?.pageIds ?? [],
    canonicalRouteTokens: definition?.routeTokens ?? [],
    viewport: detectVisualViewport(normalizedQuery),
    uxIntent: isUxIntentQuery(normalizedQuery),
    normalizedQuery,
  };
}

function structuredString(record: KnowledgeApiRecord, key: string): string | null {
  const value = record.structured[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function structuredViewport(record: KnowledgeApiRecord): VisualViewport | null {
  const value = record.structured.viewport;
  if (typeof value === "string") return value.toLocaleLowerCase().includes("mobile") ? "mobile" : value.toLocaleLowerCase().includes("desktop") ? "desktop" : null;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const name = (value as { readonly name?: unknown }).name;
    if (typeof name === "string") return name.toLocaleLowerCase().includes("mobile") ? "mobile" : name.toLocaleLowerCase().includes("desktop") ? "desktop" : null;
  }
  return null;
}

export function mediaDescriptor(record: KnowledgeApiRecord): {
  readonly mediaId: string;
  readonly pageId: string | null;
  readonly route: string | null;
  readonly viewport: VisualViewport | null;
  readonly capturedAt: string | null;
  readonly contentHash: string | null;
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
} {
  return {
    mediaId: record.id,
    pageId: structuredString(record, "pageId"),
    route: structuredString(record, "route"),
    viewport: structuredViewport(record),
    capturedAt: structuredString(record, "capturedAt") ?? structuredString(record, "captureDate") ?? record.updatedAt,
    contentHash: record.contentHash ?? structuredString(record, "contentHash"),
    title: record.title,
    summary: [record.summary, structuredString(record, "description"), structuredString(record, "visionSummary")].filter((item): item is string => Boolean(item)).join(" "),
    tags: record.tags,
  };
}

function conceptIdentityMatch(target: VisualQueryTarget, descriptor: ReturnType<typeof mediaDescriptor>): number {
  if (!target.productConcept) return 0;
  const pageId = normalizeIdentifier(descriptor.pageId);
  const title = normalizeText(descriptor.title);
  const route = normalizeText(descriptor.route ?? "");
  const canonicalPage = target.canonicalPageIds.some((id) => pageId === normalizeIdentifier(id));
  const pageTokenMatch = pageId.length > 0 && target.canonicalPageIds.some((id) => pageId.includes(normalizeIdentifier(id)) || normalizeIdentifier(id).includes(pageId));
  const titleMatch = target.canonicalPageIds.some((id) => {
    const tokens = normalizeIdentifier(id).split("-").filter((token) => token.length > 2 && token !== "public" && token !== "dashboard");
    return tokens.length > 0 && tokens.every((token) => title.includes(token));
  });
  const routeMatch = target.canonicalRouteTokens.some((token) => route.includes(normalizeText(token)));
  if (canonicalPage) return 78;
  if (pageTokenMatch) return 62;
  if (routeMatch) return 38;
  if (titleMatch) return 28;
  return 0;
}

function incidentalTextScore(target: VisualQueryTarget, descriptor: ReturnType<typeof mediaDescriptor>): number {
  const searchable = normalizeText([descriptor.title, descriptor.summary, descriptor.tags.join(" ")].join(" "));
  if (target.productConcept === "image_generation") {
    return ["image", "generation", "generate", "\u062a\u0635\u0648\u06cc\u0631"].filter((term) => searchable.includes(term)).length * 2;
  }
  if (target.productConcept === "workflow") return ["workflow", "\u0648\u0631\u06a9\u200c\u0641\u0644\u0648"].filter((term) => searchable.includes(term)).length * 2;
  const visualStopWords = new Set(["screenshot", "screen", "page", "image", "photo", "ui", "ux", "visual", "صفحه", "تصویر", "عکس", "اسکرین"]);
  return target.normalizedQuery
    .split(" ")
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter((term) => term.length >= 3 && !visualStopWords.has(term) && searchable.includes(term))
    .length;
}

export function scoreVisualMedia(record: KnowledgeApiRecord, target: VisualQueryTarget): VisualMediaCandidate {
  const descriptor = mediaDescriptor(record);
  const signals: Record<string, number> = {
    canonicalPageIdentity: conceptIdentityMatch(target, descriptor),
    titleOrProductIdentity: 0,
    routeIdentity: 0,
    categoryOrTags: 0,
    description: 0,
    incidentalText: 0,
    viewport: 0,
    freshness: 0,
  };
  if (target.productConcept && signals.canonicalPageIdentity === 0) {
    const title = normalizeText(descriptor.title);
    const route = normalizeText(descriptor.route ?? "");
    signals.titleOrProductIdentity = target.canonicalPageIds.some((id) => title.includes(normalizeText(id).replace(/^(?:public|dashboard)-/u, ""))) ? 18 : 0;
    signals.routeIdentity = target.canonicalRouteTokens.some((token) => route.includes(normalizeText(token))) ? 24 : 0;
  }
  if (target.productConcept) {
    const conceptTags = target.productConcept.split("_");
    signals.categoryOrTags = conceptTags.filter((token) => descriptor.tags.some((tag) => normalizeText(tag).includes(token))).length * 5;
  }
  signals.incidentalText = incidentalTextScore(target, descriptor);
  if (!target.productConcept) signals.description = Math.min(18, signals.incidentalText * 3);
  if (target.viewport === null) signals.viewport = descriptor.viewport === "desktop" ? 6 : descriptor.viewport === "mobile" ? 2 : 0;
  else if (descriptor.viewport === target.viewport) signals.viewport = 8;
  else if (descriptor.viewport !== null) signals.viewport = -8;
  signals.freshness = record.status?.toLocaleLowerCase() === "current" ? 4 : record.status?.toLocaleLowerCase() === "historical" ? -8 : 0;
  const score = Object.values(signals).reduce((sum, value) => sum + value, 0);
  return {
    mediaId: descriptor.mediaId,
    pageId: descriptor.pageId,
    route: descriptor.route,
    viewport: descriptor.viewport,
    capturedAt: descriptor.capturedAt,
    contentHash: descriptor.contentHash,
    score: Math.round(score * 100) / 100,
    confidence: Math.round(Math.max(0, Math.min(1, score / 100)) * 100) / 100,
    signals,
  };
}

export function sortVisualMedia(records: readonly KnowledgeApiRecord[], target: VisualQueryTarget): readonly VisualMediaCandidate[] {
  return records
    .map((record) => scoreVisualMedia(record, target))
    .sort((left, right) => right.score - left.score || (right.capturedAt ?? "").localeCompare(left.capturedAt ?? "") || left.mediaId.localeCompare(right.mediaId));
}

export function visualEvidenceFor(
  target: VisualQueryTarget,
  candidates: readonly VisualMediaCandidate[],
  reSearchUsed = false,
): ResolvedVisualEvidence {
  const selected = candidates[0] ?? null;
  if (!target.visualIntent) {
    return {
      visualIntent: false,
      target: null,
      viewport: target.viewport,
      candidates: [],
      selectedMediaId: null,
      selectedPageId: null,
      selectedRoute: null,
      selectedViewport: null,
      selectedCapturedAt: null,
      selectedContentHash: null,
      delivered: false,
      reSearchUsed: false,
      selectionReason: "not_visual",
    };
  }
  // Generic visual questions may have a useful screenshot identity without a
  // product alias. Product-targeted questions require the stronger canonical
  // identity score so incidental sidebar text cannot select a wrong page.
  const threshold = target.productConcept ? 55 : 12;
  const accepted = selected && selected.score >= threshold ? selected : null;
  return {
    visualIntent: target.visualIntent,
    target: target.productConcept,
    viewport: target.viewport,
    candidates: candidates.slice(0, 8),
    selectedMediaId: accepted?.mediaId ?? null,
    selectedPageId: accepted?.pageId ?? null,
    selectedRoute: accepted?.route ?? null,
    selectedViewport: accepted?.viewport ?? null,
    selectedCapturedAt: accepted?.capturedAt ?? null,
    selectedContentHash: accepted?.contentHash ?? null,
    delivered: false,
    reSearchUsed,
    selectionReason: accepted
      ? reSearchUsed ? "live_research_match" : accepted.signals.canonicalPageIdentity >= 60 ? "canonical_page_match" : "metadata_match"
      : selected ? "below_confidence" : "no_candidate",
  };
}

export function isVisualIntentQuery(value: string): boolean {
  return resolveVisualQuery(value).visualIntent;
}

export function visualTargetKey(target: VisualQueryTarget): string {
  return `${target.productConcept ?? "generic"}|${target.viewport ?? "default"}|${target.normalizedQuery}`.slice(0, 500);
}

export function canonicalTargetQuery(target: VisualQueryTarget): string {
  if (target.productConcept === "image_generation") return "image generation product page screenshot";
  if (target.productConcept === "video_generation") return "video generation product page screenshot";
  if (target.productConcept === "workflow") return "workflow store product page screenshot";
  if (target.productConcept === "chat") return "chat product page screenshot";
  if (target.productConcept === "image_editing") return "image editing product page screenshot";
  return target.normalizedQuery.slice(0, 300);
}

export function visualMetadata(record: KnowledgeApiRecord): JsonVisualMetadata {
  const descriptor = mediaDescriptor(record);
  return {
    mediaId: descriptor.mediaId,
    pageId: descriptor.pageId,
    route: descriptor.route,
    viewport: descriptor.viewport,
    capturedAt: descriptor.capturedAt,
    contentHash: descriptor.contentHash,
  };
}

export interface JsonVisualMetadata {
  readonly mediaId: string;
  readonly pageId: string | null;
  readonly route: string | null;
  readonly viewport: VisualViewport | null;
  readonly capturedAt: string | null;
  readonly contentHash: string | null;
}
