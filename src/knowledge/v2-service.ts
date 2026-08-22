import type { JsonObject } from "../database/validation";
import type { EventRepository } from "../database/repositories/events";
import type { ContextPackItem, MemoryItemType } from "../memory/types";
import { knowledgeApiPath, KnowledgeApiError, LumaKnowledgeClient, type KnowledgeApiRecord } from "./client";
import { KnowledgeV2Repository, knowledgeCacheKey } from "./v2-repository";

const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const SUPPORTED_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface KnowledgeV2Telemetry {
  readonly liveSearchUsed: boolean;
  readonly itemsSelected: number;
  readonly kinds: readonly string[];
  readonly freshestUpdatedAt: string | null;
  readonly stale: boolean;
  readonly mediaSelected: number;
  readonly imagesDelivered: number;
  readonly apiLatencyMs: number | null;
}

export interface KnowledgeV2SearchResult {
  readonly items: readonly ContextPackItem[];
  readonly telemetry: KnowledgeV2Telemetry;
}

function authorityScore(value: string | null, epistemicType: string | null = null): number {
  const selected = value ?? epistemicType;
  const explicit = Number(selected);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));
  return {
    CURRENT_OPERATIONAL_DATA: 100, DECISION: 95, OFFICIAL_FACT: 90,
    EXPERIMENT_RESULT: 78, CUSTOMER_SIGNAL: 75, RESEARCH: 60,
    TEAM_NOTE: 65, PROPOSAL: 45, HYPOTHESIS: 35, HISTORICAL: 30,
  }[(selected ?? "").toUpperCase()] ?? 50;
}

function itemType(record: KnowledgeApiRecord): MemoryItemType {
  return record.kind.toLowerCase().includes("document") ? "knowledge_v2_chunk" : "knowledge_v2_item";
}

function excerpt(record: KnowledgeApiRecord): string {
  const text = [record.summary ?? "", record.contentText ?? "", JSON.stringify(record.structured)].join("\n").replace(/\s+/gu, " ").trim();
  return text.slice(0, 1_200);
}

function contextItem(record: KnowledgeApiRecord, visualDelivered = false): ContextPackItem {
  const sourceId = knowledgeCacheKey(record);
  return {
    type: itemType(record), sourceId, title: record.title,
    pathOrUrl: knowledgeApiPath(record.kind, record.id),
    excerpt: excerpt(record), authority: authorityScore(record.authority, record.type), score: authorityScore(record.authority, record.type) / 100,
    updatedAt: record.updatedAt ?? record.createdAt ?? new Date(0).toISOString(), threadId: null, ownerAgentId: null,
    provenance: {
      sourceKind: "knowledge_v2", knowledgeItemId: record.id, kind: record.kind,
      type: record.type, epistemicType: record.type, category: record.category, visibility: record.visibility,
      authority: record.authority, status: record.status, updatedAt: record.updatedAt,
      reviewAfter: record.reviewAfter, sourceUrl: record.kind.toLowerCase().includes("media") ? null : record.sourceUrl,
      ...(record.kind.toLowerCase().includes("media") ? { media: true, visualDelivered } : {}),
    },
  };
}

function mergeRecord(existing: KnowledgeApiRecord, incoming: KnowledgeApiRecord): KnowledgeApiRecord {
  return {
    ...existing,
    ...incoming,
    contentText: incoming.contentText ?? existing.contentText,
    summary: incoming.summary ?? existing.summary,
    sourceUrl: incoming.sourceUrl ?? existing.sourceUrl,
    updatedAt: incoming.updatedAt ?? existing.updatedAt,
    structured: Object.keys(incoming.structured).length > 0 ? incoming.structured : existing.structured,
    tags: incoming.tags.length > 0 ? incoming.tags : existing.tags,
  };
}

function mergeRecords(records: readonly KnowledgeApiRecord[]): readonly KnowledgeApiRecord[] {
  const map = new Map<string, KnowledgeApiRecord>();
  for (const record of records) {
    const key = knowledgeCacheKey(record);
    map.set(key, map.has(key) ? mergeRecord(map.get(key)!, record) : record);
  }
  return [...map.values()];
}

async function readBoundedBytes(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_MEDIA_BYTES) throw new Error("knowledge_media_size_rejected");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("knowledge_media_size_rejected");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_MEDIA_BYTES) {
      await reader.cancel();
      throw new Error("knowledge_media_size_rejected");
    }
    chunks.push(next.value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function detectImage(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && bytes[5] === 0x61) return "image/gif";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  return btoa(binary);
}

export class KnowledgeV2Service {
  private readonly recentLiveSearches = new Map<string, { readonly at: number; readonly result: KnowledgeV2SearchResult }>();

  constructor(
    readonly repository: KnowledgeV2Repository,
    readonly client: LumaKnowledgeClient,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly events?: EventRepository,
  ) {}

  get configured(): boolean { return this.client.configured; }

  async searchForContext(input: {
    readonly query: string;
    readonly agentId?: string;
    readonly threadId?: string;
    readonly currentState?: boolean;
    readonly visual?: boolean;
    readonly limit?: number;
  }): Promise<KnowledgeV2SearchResult> {
    const query = input.query.trim().slice(0, 300);
    if (!query || !this.configured) return { items: [], telemetry: emptyTelemetry() };
    // The evidence pack is shared across Agents for the same bounded turn.
    // Agent identity changes the interpretation layer, not this factual search.
    const cacheKey = `${query}|${input.currentState ? "current" : "normal"}|${input.visual ? "visual" : "text"}|${Math.min(input.limit ?? 6, 8)}`;
    const cached = this.recentLiveSearches.get(cacheKey);
    if (cached && Date.now() - cached.at < 30_000) return cached.result;
    const started = Date.now();
    try {
      const records = await this.client.search(query, {
        limit: Math.min(Math.max(input.limit ?? 6, 1), 8),
        kind: input.visual ? "media" : undefined,
      });
      const allowed = records.filter((record) => record.visibility !== "RESTRICTED" && record.visibility !== "UNKNOWN" && !record.deleted);
      for (const record of allowed.slice(0, 8)) await this.repository.upsert(record, this.now());
      const result = {
        items: allowed.slice(0, 8).map((record) => contextItem(record)),
        telemetry: {
          liveSearchUsed: true, itemsSelected: allowed.length, kinds: [...new Set(allowed.map((record) => record.kind))],
          freshestUpdatedAt: allowed.map((record) => record.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
          stale: false, mediaSelected: allowed.filter((record) => record.kind.toLowerCase().includes("media")).length,
          imagesDelivered: 0, apiLatencyMs: Date.now() - started,
        },
      } satisfies KnowledgeV2SearchResult;
      if (allowed.length === 0 && records.length === 0) await this.recordKnowledgeGap(query, input.agentId, input.threadId);
      this.recentLiveSearches.set(cacheKey, { at: Date.now(), result });
      return result;
    } catch (error: unknown) {
      const result = { items: [], telemetry: { ...emptyTelemetry(), stale: true, apiLatencyMs: Date.now() - started } };
      if (error instanceof KnowledgeApiError && (error.category === "unauthorized" || error.category === "forbidden")) throw error;
      return result;
    }
  }

  async fetchMediaDataUrl(id: string): Promise<{ readonly dataUrl: string; readonly mimeType: string; readonly byteLength: number }> {
    const response = await this.client.getMediaContent(id);
    if (!response.ok) throw new Error(`knowledge_media_http_${response.status}`);
    const declared = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
    if (declared === "image/svg+xml" || (declared && !SUPPORTED_MEDIA_TYPES.has(declared))) throw new Error("knowledge_media_type_rejected");
    const bytes = await readBoundedBytes(response);
    const detected = detectImage(bytes);
    if (!detected || !SUPPORTED_MEDIA_TYPES.has(detected) || (declared && declared !== detected)) throw new Error("knowledge_media_magic_rejected");
    return { dataUrl: `data:${detected};base64,${toBase64(bytes)}`, mimeType: detected, byteLength: bytes.byteLength };
  }

  async sync(mode: "full" | "incremental" = "incremental"): Promise<JsonObject> {
    return mode === "full" ? this.fullSync() : this.incrementalSync();
  }

  private async fullSync(): Promise<JsonObject> {
    const attemptedAt = this.now();
    let apiCalls = 0;
    try {
      const manifest = await this.client.manifest(); apiCalls += 1;
      const pages = await Promise.all([this.client.listItems(), this.client.listDocuments(), this.client.listPeople(), this.client.listEntities(), this.client.listMedia()]);
      apiCalls += pages.length;
      let records = mergeRecords(pages.flat());
      const hydrated: KnowledgeApiRecord[] = [];
      for (const record of records.slice(0, 1_000)) {
        if (record.kind.toLowerCase().includes("document") && !record.contentText) {
          const detail = await this.client.getDocument(record.id); apiCalls += 1;
          hydrated.push(detail ? mergeRecord(record, detail) : record);
        } else hydrated.push(record);
      }
      records = mergeRecords(hydrated).filter((record) => record.visibility !== "RESTRICTED" && record.visibility !== "UNKNOWN");
      const seen: string[] = [];
      for (const record of records) { await this.repository.upsert(record, attemptedAt); seen.push(knowledgeCacheKey(record)); }
      if (seen.length > 0) await this.repository.markFullReconciliationMissing(seen, attemptedAt);
      const counts = { total: records.length, byKind: Object.fromEntries([...new Set(records.map((record) => record.kind))].map((kind) => [kind, records.filter((record) => record.kind === kind).length])) };
      const cursor = records.map((record) => record.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? attemptedAt;
      await this.repository.updateState({ attemptedAt, successfulAt: attemptedAt, fullSyncAt: attemptedAt, cursor, mode: "full", manifest, counts, apiCalls, recordsChanged: records.length, error: null });
      return { mode: "full", records: records.length, apiCalls, counts };
    } catch (error: unknown) {
      await this.repository.updateState({ attemptedAt, mode: "full", apiCalls, error: error instanceof KnowledgeApiError ? error.category : "sync_failure" }).catch(() => undefined);
      throw error;
    }
  }

  private async incrementalSync(): Promise<JsonObject> {
    const attemptedAt = this.now();
    const state = await this.repository.getState();
    if (!state?.last_successful_at) return this.fullSync();
    let apiCalls = 0;
    try {
      const changed = await this.client.changesSince(state.changes_cursor ?? state.last_successful_at!); apiCalls += 1;
      const records: KnowledgeApiRecord[] = [];
      for (const change of changed.slice(0, 500)) {
        if (change.deleted) { await this.repository.markDeleted(change, attemptedAt); continue; }
        const normalizedKind = change.kind.toLowerCase();
        const detail = normalizedKind.includes("document")
          ? await this.client.getDocument(change.id)
          : normalizedKind.includes("person") || normalizedKind === "people"
            ? await this.client.getPerson(change.id)
            : normalizedKind.includes("entity") || normalizedKind === "entities"
              ? await this.client.getEntity(change.id)
              : normalizedKind.includes("media") || normalizedKind.includes("screenshot")
                ? await this.client.getMedia(change.id)
                : await this.client.getItem(change.id);
        apiCalls += 1;
        records.push(detail ? mergeRecord(change, detail) : change);
      }
      for (const record of records.filter((item) => item.visibility !== "RESTRICTED" && item.visibility !== "UNKNOWN")) await this.repository.upsert(record, attemptedAt);
      const cursor = records.map((record) => record.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? attemptedAt;
      if (records.length > 0) {
        await this.events?.append({
          eventType: "knowledge_change_detected", aggregateType: "knowledge_v2", aggregateId: "default",
          idempotencyKey: `knowledge-change:${cursor}`, payload: { mode: "incremental", records: records.length, kinds: [...new Set(records.map((record) => record.kind))] },
        });
      }
      await this.repository.updateState({ attemptedAt, successfulAt: attemptedAt, incrementalSyncAt: attemptedAt, cursor, mode: "incremental", apiCalls, recordsChanged: records.length, error: null });
      return { mode: "incremental", records: records.length, apiCalls };
    } catch (error: unknown) {
      await this.repository.updateState({ attemptedAt, mode: "incremental", apiCalls, error: error instanceof KnowledgeApiError ? error.category : "sync_failure" }).catch(() => undefined);
      throw error;
    }
  }

  private async recordKnowledgeGap(query: string, agentId?: string, threadId?: string): Promise<void> {
    if (!this.events) return;
    const normalized = query.toLocaleLowerCase().replace(/\s+/gu, " ").trim().slice(0, 240);
    let hash = 2166136261;
    for (const character of normalized) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    await this.events.append({
      eventType: "knowledge_gap_detected", aggregateType: "knowledge_v2", aggregateId: normalized.slice(0, 80) || "empty",
      threadId,
      idempotencyKey: `knowledge-gap:${new Date(this.now()).toISOString().slice(0, 10)}:${(hash >>> 0).toString(16)}`,
      payload: { query: normalized, agentId: agentId ?? null, missingEvidenceKind: "unknown" },
    }).catch(() => undefined);
  }
}

function emptyTelemetry(): KnowledgeV2Telemetry {
  return { liveSearchUsed: false, itemsSelected: 0, kinds: [], freshestUpdatedAt: null, stale: false, mediaSelected: 0, imagesDelivered: 0, apiLatencyMs: null };
}
