import type { JsonObject, JsonValue } from "../database/validation";

export const DEFAULT_LUMA_KNOWLEDGE_BASE_URL = "https://luma-knowledge.pages.dev/api/v1";
const MAX_JSON_BYTES = 4_000_000;
const MAX_LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 20;
const APPROVED_MEDIA_HOSTS = [
  /^.+\.uploadthing\.com$/u,
  /^.+\.uploadthingusercontent\.com$/u,
  /^.+\.ufs\.sh$/u,
  /^.+\.utfs\.io$/u,
];

export type KnowledgeVisibility = "PUBLIC" | "INTERNAL" | "MANAGEMENT" | "RESTRICTED" | "UNKNOWN";

export interface KnowledgeApiRecord {
  readonly id: string;
  readonly kind: string;
  readonly category: string | null;
  readonly type: string | null;
  readonly visibility: KnowledgeVisibility;
  readonly language: string | null;
  readonly status: string | null;
  readonly authority: string | null;
  readonly owner: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly contentText: string | null;
  readonly structured: JsonObject;
  readonly tags: readonly string[];
  readonly sourceUrl: string | null;
  readonly updatedAt: string | null;
  readonly createdAt: string | null;
  readonly reviewAfter: string | null;
  readonly contentHash: string | null;
  readonly versionMarker: string | null;
  readonly deleted: boolean;
}

export interface KnowledgeListPage {
  readonly records: readonly KnowledgeApiRecord[];
  readonly nextCursor: string | null;
}

export function knowledgeResourceSegment(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (normalized.includes("document")) return "documents";
  if (normalized.includes("person") || normalized === "people") return "people";
  if (normalized.includes("entity") || normalized === "entities") return "entities";
  if (normalized.includes("media") || normalized === "screenshot" || normalized === "screenshots") return "media";
  return "items";
}

export function knowledgeApiPath(kind: string, id: string): string {
  return `/api/v1/${knowledgeResourceSegment(kind)}/${encodeURIComponent(id)}`;
}

export interface KnowledgeClientOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export class KnowledgeApiError extends Error {
  readonly status: number | null;
  readonly category: "not_configured" | "unauthorized" | "forbidden" | "rate_limited" | "timeout" | "http" | "malformed" | "network";
  readonly retryable: boolean;

  constructor(input: { readonly message: string; readonly status?: number | null; readonly category: KnowledgeApiError["category"]; readonly retryable: boolean }) {
    super(input.message);
    this.name = "KnowledgeApiError";
    this.status = input.status ?? null;
    this.category = input.category;
    this.retryable = input.retryable;
  }
}

function boundedString(value: unknown, max = 100_000): string | null {
  return typeof value === "string" && value.trim().length > 0 ? sanitizeRemoteText(value, max) : null;
}

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;
const SENSITIVE_URL_QUERY_PATTERN = /(?:[?&](?:token|access_token|auth|authorization|secret|signature|sig|key|expires|x-amz-[^=]+)=)/iu;

function sanitizeRemoteText(value: string, max: number): string {
  return value.slice(0, max)
    .replace(BEARER_PATTERN, "[redacted-token]")
    .replace(URL_PATTERN, (url) => SENSITIVE_URL_QUERY_PATTERN.test(url) ? "[redacted-url]" : url);
}

function safeJsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > 4 || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "string") return sanitizeRemoteText(value, 8_000);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "boolean" || value === null) return value;
    return null;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) result[key.slice(0, 100)] = safeJsonValue(item, depth + 1);
    return result;
  }
  return null;
}

function safeObject(value: unknown): JsonObject {
  const parsed = safeJsonValue(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as JsonObject : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? sanitizeRemoteText(value.trim(), 500) : null;
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const result = stringValue(value[key]);
    if (result) return result;
  }
  return null;
}

function unwrap(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const object = value as Record<string, unknown>;
  for (const key of ["item", "record", "document", "person", "entity", "media", "data"]) {
    const nested = object[key];
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) return nested as Record<string, unknown>;
  }
  return object;
}

function visibility(value: unknown): KnowledgeVisibility {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "PUBLIC" || normalized === "INTERNAL" || normalized === "MANAGEMENT" || normalized === "RESTRICTED"
    ? normalized
    : "UNKNOWN";
}

function tags(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 40).map((item) => item.trim().slice(0, 120));
}

export function normalizeKnowledgeRecord(value: unknown, fallbackKind = "item"): KnowledgeApiRecord | null {
  const rawObject = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const object = unwrap(value);
  const id = firstString(object, ["id", "itemId", "documentId", "personId", "entityId", "mediaId", "slug", "key"]);
  if (!id) return null;
  const kind = firstString(object, ["kind", "resourceKind", "resourceType"]) ?? fallbackKind;
  const title = firstString(object, ["title", "name", "displayName", "label"]) ?? id;
  const contentText = boundedString(object.content ?? object.body ?? object.markdown ?? object.text ?? object.excerpt ?? object.description ?? object.visionSummary, 180_000);
  const reserved = new Set(["id", "itemId", "documentId", "personId", "entityId", "mediaId", "slug", "key", "kind", "resourceKind", "resourceType", "title", "name", "displayName", "label", "content", "body", "markdown", "text", "excerpt", "description", "visionSummary", "tags", "visibility", "updatedAt", "updated_at", "createdAt", "created_at", "reviewAfter", "review_after", "status", "authority", "owner", "sourceUrl", "url", "contentHash", "content_hash", "version", "versionMarker", "deleted"]);
  const structured: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(object)) {
    if (!reserved.has(key)) structured[key.slice(0, 100)] = safeJsonValue(item);
  }
  return {
    id,
    kind,
    category: firstString(object, ["category", "categoryKey"]),
    type: firstString(object, ["type", "recordType", "epistemicType"]),
    visibility: visibility(object.visibility ?? object.access),
    language: firstString(object, ["language", "locale"]),
    status: firstString(object, ["status", "state"]),
    authority: firstString(object, ["authority", "sourceAuthority"]),
    owner: firstString(object, ["owner", "ownerId", "ownerName"]),
    title,
    summary: firstString(object, ["summary", "shortDescription", "description"]),
    contentText,
    structured: safeObject(structured),
    tags: tags(object.tags ?? object.labels),
    sourceUrl: firstString(object, ["sourceUrl", "canonicalUrl", "url"]),
    updatedAt: firstString(object, ["updatedAt", "updated_at", "modifiedAt"]),
    createdAt: firstString(object, ["createdAt", "created_at"]),
    reviewAfter: firstString(object, ["reviewAfter", "review_after"]),
    contentHash: firstString(object, ["contentHash", "content_hash", "hash"]),
    versionMarker: firstString(object, ["version", "versionMarker", "revision"]),
    deleted: object.deleted === true
      || rawObject.deleted === true
      || [rawObject.action, rawObject.operation, rawObject.event].some((item) => String(item ?? "").toLowerCase() === "deleted")
      || String(object.status ?? "").toLowerCase() === "deleted",
  };
}

function recordsFromBody(body: unknown, fallbackKind: string): readonly KnowledgeApiRecord[] {
  if (Array.isArray(body)) return body.map((item) => normalizeKnowledgeRecord(item, fallbackKind)).filter((item): item is KnowledgeApiRecord => item !== null);
  if (typeof body !== "object" || body === null) return [];
  const object = body as Record<string, unknown>;
  for (const key of ["items", "records", "results", "data", "changes"]) {
    if (Array.isArray(object[key])) return object[key].map((item) => normalizeKnowledgeRecord(item, fallbackKind)).filter((item): item is KnowledgeApiRecord => item !== null);
  }
  for (const key of ["data", "result", "payload"]) {
    if (typeof object[key] === "object" && object[key] !== null) {
      const nested = recordsFromBody(object[key], fallbackKind);
      if (nested.length > 0) return nested;
    }
  }
  const single = normalizeKnowledgeRecord(body, fallbackKind);
  return single ? [single] : [];
}

function nextCursorFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const object = body as Record<string, unknown>;
  const pagination = typeof object.pagination === "object" && object.pagination !== null ? object.pagination as Record<string, unknown> : {};
  const meta = typeof object.meta === "object" && object.meta !== null ? object.meta as Record<string, unknown> : {};
  const nested = typeof object.data === "object" && object.data !== null ? object.data as Record<string, unknown> : {};
  const nestedPagination = typeof nested.pagination === "object" && nested.pagination !== null ? nested.pagination as Record<string, unknown> : {};
  return firstString(object, ["nextCursor", "next_cursor", "cursorNext", "next"])
    ?? firstString(pagination, ["nextCursor", "next_cursor", "next"])
    ?? firstString(meta, ["nextCursor", "next_cursor", "next"])
    ?? firstString(nested, ["nextCursor", "next_cursor", "cursorNext", "next"])
    ?? firstString(nestedPagination, ["nextCursor", "next_cursor", "next"]);
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new KnowledgeApiError({ message: "Knowledge response exceeded the bounded size", category: "malformed", retryable: false });
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new KnowledgeApiError({ message: "Knowledge response exceeded the bounded size", category: "malformed", retryable: false });
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new KnowledgeApiError({ message: "Knowledge response exceeded the bounded size", category: "malformed", retryable: false });
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

export class LumaKnowledgeClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly conditionalJson = new Map<string, { readonly etag: string | null; readonly lastModified: string | null; readonly body: string }>();

  constructor(options: KnowledgeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_LUMA_KNOWLEDGE_BASE_URL).replace(/\/+$/u, "");
    const parsed = new URL(this.baseUrl);
    if (parsed.protocol !== "https:") throw new KnowledgeApiError({ message: "Knowledge base URL must use HTTPS", category: "malformed", retryable: false });
    this.token = options.token?.trim() ?? "";
    this.fetcher = (options.fetcher ?? fetch).bind(globalThis);
    this.timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 12_000, 30_000));
    this.maxResponseBytes = Math.max(64_000, Math.min(options.maxResponseBytes ?? MAX_JSON_BYTES, 8_000_000));
  }

  get configured(): boolean { return this.token.length > 0; }

  async health(): Promise<JsonObject> { return this.getObject("/health"); }
  async manifest(): Promise<JsonObject> { return this.getObject("/manifest"); }
  async getItem(id: string): Promise<KnowledgeApiRecord | null> { return this.getRecord(`/items/${encodeURIComponent(id)}`, "item"); }
  async getDocument(id: string): Promise<KnowledgeApiRecord | null> { return this.getRecord(`/documents/${encodeURIComponent(id)}`, "document"); }
  async getEntity(id: string): Promise<KnowledgeApiRecord | null> { return this.getRecord(`/entities/${encodeURIComponent(id)}`, "entity"); }
  async getPerson(id: string): Promise<KnowledgeApiRecord | null> { return this.getRecord(`/people/${encodeURIComponent(id)}`, "person"); }
  async getMedia(id: string): Promise<KnowledgeApiRecord | null> { return this.getRecord(`/media/${encodeURIComponent(id)}`, "media"); }

  async categories(): Promise<JsonObject> { return this.getObject("/categories"); }

  async search(query: string, filters: { readonly visibility?: KnowledgeVisibility; readonly kind?: string; readonly category?: string; readonly viewport?: string; readonly limit?: number } = {}): Promise<readonly KnowledgeApiRecord[]> {
    const params = new URLSearchParams({ q: query.slice(0, 300), limit: String(Math.min(Math.max(filters.limit ?? 8, 1), MAX_LIST_PAGE_SIZE)) });
    if (filters.visibility) params.set("visibility", filters.visibility);
    if (filters.kind) params.set("kind", filters.kind.slice(0, 80));
    if (filters.category) params.set("category", filters.category.slice(0, 80));
    if (filters.viewport) params.set("viewport", filters.viewport.slice(0, 30));
    const body = await this.getJson(`/search?${params.toString()}`);
    return recordsFromBody(body, "search");
  }

  async listItems(): Promise<readonly KnowledgeApiRecord[]> { return this.listResource("/items", "item"); }
  async listDocuments(): Promise<readonly KnowledgeApiRecord[]> { return this.listResource("/documents", "document"); }
  async listEntities(): Promise<readonly KnowledgeApiRecord[]> { return this.listResource("/entities", "entity"); }
  async listPeople(): Promise<readonly KnowledgeApiRecord[]> { return this.listResource("/people", "person"); }
  async listMedia(): Promise<readonly KnowledgeApiRecord[]> { return this.listResource("/media", "media"); }

  async changesSince(since: string): Promise<readonly KnowledgeApiRecord[]> {
    const body = await this.getJson(`/changes?since=${encodeURIComponent(since)}`);
    return recordsFromBody(body, "change");
  }

  async getMediaContent(id: string): Promise<Response> {
    // The content endpoint is still part of the authenticated Knowledge API.
    // Only the subsequent provider fetch is deliberately unauthenticated.
    const first = await this.request(`/media/${encodeURIComponent(id)}/content`, { redirect: "manual" }, true);
    if (first.status < 300 || first.status >= 400) return first;
    const location = first.headers.get("location");
    if (!location) throw new KnowledgeApiError({ message: "Knowledge media redirect was missing", category: "malformed", retryable: false });
    const target = new URL(location, this.baseUrl);
    const sameOrigin = target.origin === new URL(this.baseUrl).origin;
    if (target.protocol !== "https:" || (!sameOrigin && !APPROVED_MEDIA_HOSTS.some((pattern) => pattern.test(target.hostname)))) {
      throw new KnowledgeApiError({ message: "Knowledge media redirect was not approved", category: "malformed", retryable: false });
    }
    // Authorization is retained only for the configured Knowledge origin.
    const providerResponse = await this.fetcher(target.toString(), {
      method: "GET", redirect: "manual",
      headers: sameOrigin ? { authorization: `Bearer ${this.token}`, accept: "application/octet-stream" } : undefined,
    });
    if (providerResponse.status >= 300 && providerResponse.status < 400) {
      throw new KnowledgeApiError({ message: "Knowledge media provider returned an unexpected redirect", status: providerResponse.status, category: "malformed", retryable: false });
    }
    return providerResponse;
  }

  private async listResource(path: string, fallbackKind: string): Promise<readonly KnowledgeApiRecord[]> {
    const records: KnowledgeApiRecord[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const url = `${path}?limit=${MAX_LIST_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const body = await this.getJson(url);
      records.push(...recordsFromBody(body, fallbackKind));
      const next = nextCursorFromBody(body);
      if (!next || next === cursor) break;
      cursor = next;
    }
    return [...new Map(records.map((record) => [`${record.kind}:${record.id}`, record])).values()];
  }

  private async getRecord(path: string, fallbackKind: string): Promise<KnowledgeApiRecord | null> {
    const records = recordsFromBody(await this.getJson(path), fallbackKind);
    return records[0] ?? null;
  }

  private async getObject(path: string): Promise<JsonObject> {
    return safeObject(await this.getJson(path));
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.request(path, { method: "GET", redirect: "manual" }, true);
    const cached = this.conditionalJson.get(path);
    if (response.status === 304) {
      if (!cached) throw new KnowledgeApiError({ message: "Knowledge returned 304 without a cached response", status: 304, category: "malformed", retryable: false });
      try { return JSON.parse(cached.body) as unknown; } catch { throw new KnowledgeApiError({ message: "Cached Knowledge response was invalid JSON", status: 304, category: "malformed", retryable: false }); }
    }
    const text = await readBounded(response, this.maxResponseBytes);
    if (response.ok) {
      const etag = response.headers.get("etag");
      const lastModified = response.headers.get("last-modified");
      if (etag || lastModified) this.conditionalJson.set(path, { etag, lastModified, body: text });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new KnowledgeApiError({ message: "Knowledge response was not valid JSON", status: response.status, category: "malformed", retryable: false });
    }
  }

  private async request(path: string, init: RequestInit, includeAuth: boolean): Promise<Response> {
    if (!this.token) throw new KnowledgeApiError({ message: "Knowledge API token is not configured", category: "not_configured", retryable: false });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (includeAuth) headers.set("authorization", `Bearer ${this.token}`);
    const cached = this.conditionalJson.get(path);
    if (includeAuth && cached?.etag) headers.set("if-none-match", cached.etag);
    if (includeAuth && cached?.lastModified) headers.set("if-modified-since", cached.lastModified);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, { ...init, headers, signal: controller.signal });
      if (!response.ok && response.status !== 304 && (response.status < 300 || response.status >= 400)) {
        const status = response.status;
        throw new KnowledgeApiError({
          message: `Knowledge API returned HTTP ${status}`,
          status,
          category: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 429 ? "rate_limited" : "http",
          retryable: status === 408 || status === 429 || status >= 500,
        });
      }
      return response;
    } catch (error: unknown) {
      if (error instanceof KnowledgeApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new KnowledgeApiError({ message: "Knowledge API request timed out", category: "timeout", retryable: true });
      throw new KnowledgeApiError({ message: "Knowledge API request failed", category: "network", retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createLumaKnowledgeClient(environment: { readonly LUMA_KNOWLEDGE_API_TOKEN?: string; readonly LUMA_KNOWLEDGE_BASE_URL?: string }): LumaKnowledgeClient {
  return new LumaKnowledgeClient({ baseUrl: environment.LUMA_KNOWLEDGE_BASE_URL, token: environment.LUMA_KNOWLEDGE_API_TOKEN });
}
