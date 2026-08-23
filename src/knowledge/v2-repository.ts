import type { DatabaseClient } from "../database/client";
import type { JsonObject, JsonValue } from "../database/validation";
import { encodeObject } from "../database/validation";
import { chunkMarkdown } from "./markdown";
import { knowledgeApiPath, knowledgeResourceSegment, type KnowledgeApiRecord } from "./client";

export interface KnowledgeV2CacheRecord extends KnowledgeApiRecord {
  readonly cacheKey: string;
}

interface ItemRow {
  cache_key: string;
  item_id: string;
  kind: string;
  category: string | null;
  item_type: string | null;
  visibility: string;
  language: string | null;
  status: string | null;
  authority: string | null;
  owner: string | null;
  title: string;
  summary: string | null;
  content_text: string | null;
  structured_json: string;
  tags_json: string;
  source_api_url: string | null;
  source_url: string | null;
  updated_at: string | null;
  created_at: string | null;
  review_after: string | null;
  content_hash: string | null;
  version_marker: string | null;
  last_synced_at: string;
  stale: number;
  deleted_at: string | null;
}

interface StateRow {
  state_key: string;
  last_attempted_at: string | null;
  last_successful_at: string | null;
  last_full_sync_at: string | null;
  last_incremental_sync_at: string | null;
  changes_cursor: string | null;
  last_mode: string | null;
  manifest_json: string;
  counts_json: string;
  api_calls: number;
  records_changed: number;
  last_error: string | null;
  updated_at: string;
}

function parseJson(value: string, fallback: JsonValue): JsonValue {
  try { return JSON.parse(value) as JsonValue; } catch { return fallback; }
}

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}

function asStrings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 40) : [];
}

function mapItem(row: ItemRow): KnowledgeV2CacheRecord {
  return {
    cacheKey: row.cache_key,
    id: row.item_id,
    kind: row.kind,
    category: row.category,
    type: row.item_type,
    visibility: row.visibility as KnowledgeApiRecord["visibility"],
    language: row.language,
    status: row.status,
    authority: row.authority,
    owner: row.owner,
    title: row.title,
    summary: row.summary,
    contentText: row.content_text,
    structured: asObject(parseJson(row.structured_json, {})),
    tags: asStrings(parseJson(row.tags_json, [])),
    sourceUrl: row.source_url,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    reviewAfter: row.review_after,
    contentHash: row.content_hash,
    versionMarker: row.version_marker,
    deleted: row.deleted_at !== null,
  };
}

function authorityScore(authority: string | null): number {
  const normalized = authority?.trim().toUpperCase() ?? "";
  const explicit = Number(normalized);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));
  return {
    CURRENT_OPERATIONAL_DATA: 100,
    DECISION: 95,
    OFFICIAL_FACT: 90,
    EXPERIMENT_RESULT: 78,
    CUSTOMER_SIGNAL: 75,
    TEAM_NOTE: 65,
    PERSONAL_NOTE: 55,
    RESEARCH: 60,
    PROPOSAL: 45,
    HYPOTHESIS: 35,
    HISTORICAL: 30,
  }[normalized] ?? 50;
}

function cacheKey(record: KnowledgeApiRecord): string {
  return `${record.kind}:${record.id}`.slice(0, 500);
}

function searchText(record: KnowledgeApiRecord): string {
  return [
    record.title,
    record.summary ?? "",
    record.tags.join(" "),
    record.type ?? "",
    record.category ?? "",
    record.authority ?? "",
    record.contentText ?? "",
    JSON.stringify(record.structured).slice(0, 8_000),
  ].join("\n").slice(0, 40_000);
}

function storedSourceUrl(record: KnowledgeApiRecord): string | null {
  // Media provider URLs can be signed or public-by-link. They are not needed
  // for retrieval and must never become a durable projection surface.
  if (knowledgeResourceSegment(record.kind) === "media") return null;
  const value = record.sourceUrl?.trim() ?? "";
  if (!value || value.length > 1_000 || /(?:token|authorization|secret|signature|sig)=/iu.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? `${parsed.origin}${parsed.pathname}` : null;
  } catch {
    return null;
  }
}

export class KnowledgeV2Repository {
  constructor(private readonly database: DatabaseClient) {}

  async upsert(record: KnowledgeApiRecord, syncedAt: string): Promise<KnowledgeV2CacheRecord> {
    const key = cacheKey(record);
    const chunks = record.kind.toLowerCase().includes("document") && record.contentText
      ? chunkMarkdown(record.contentText).slice(0, 80)
      : [];
    const statements = [
      this.database.prepare("DELETE FROM institutional_memory_fts WHERE source_kind IN ('knowledge_v2_item', 'knowledge_v2_chunk') AND (source_id = ? OR source_id IN (SELECT id FROM knowledge_v2_chunks WHERE item_cache_key = ?))").bind(key, key),
      this.database.prepare("DELETE FROM knowledge_v2_chunks WHERE item_cache_key = ?").bind(key),
      this.database.prepare(
        `INSERT INTO knowledge_v2_items (
          cache_key, item_id, kind, category, item_type, visibility, language, status, authority, owner,
          title, summary, content_text, structured_json, tags_json, source_api_url, source_url,
          updated_at, created_at, review_after, content_hash, version_marker, last_synced_at, stale, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          item_id = excluded.item_id, kind = excluded.kind, category = excluded.category,
          item_type = excluded.item_type, visibility = excluded.visibility, language = excluded.language,
          status = excluded.status, authority = excluded.authority, owner = excluded.owner,
          title = excluded.title, summary = excluded.summary, content_text = excluded.content_text,
          structured_json = excluded.structured_json, tags_json = excluded.tags_json,
          source_api_url = excluded.source_api_url, source_url = excluded.source_url,
          updated_at = excluded.updated_at, created_at = excluded.created_at, review_after = excluded.review_after,
          content_hash = excluded.content_hash, version_marker = excluded.version_marker,
          last_synced_at = excluded.last_synced_at, stale = 0, deleted_at = excluded.deleted_at`,
      ).bind(
        key, record.id, record.kind, record.category, record.type, record.visibility, record.language, record.status,
        record.authority, record.owner, record.title, record.summary, record.contentText,
        encodeObject(record.structured, "knowledge_v2.structured"), JSON.stringify(record.tags),
        knowledgeApiPath(record.kind, record.id), storedSourceUrl(record), record.updatedAt, record.createdAt,
        record.reviewAfter, record.contentHash, record.versionMarker, syncedAt, record.deleted ? syncedAt : null,
      ),
      this.database.prepare(
        `INSERT INTO institutional_memory_fts (source_kind, source_id, title, path_or_url, content_text, tags_text, authority, updated_at)
         VALUES ('knowledge_v2_item', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(key, record.title, knowledgeApiPath(record.kind, record.id), searchText(record), record.tags.join(" "), authorityScore(record.authority ?? record.type), record.updatedAt ?? syncedAt),
    ];
    for (const [ordinal, chunk] of chunks.entries()) {
      const id = `${key}:${ordinal}`.slice(0, 500);
      statements.push(
        this.database.prepare(
          `INSERT INTO knowledge_v2_chunks (id, item_cache_key, ordinal, heading, content_text, content_hash, metadata_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, key, ordinal, chunk.heading ?? null, chunk.contentText, record.contentHash, encodeObject({ sourceId: record.id, kind: record.kind }, "knowledge_v2.chunk.metadata"), record.updatedAt ?? syncedAt),
        this.database.prepare(
          `INSERT INTO institutional_memory_fts (source_kind, source_id, title, path_or_url, content_text, tags_text, authority, updated_at)
           VALUES ('knowledge_v2_chunk', ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, `${record.title}${chunk.heading ? ` — ${chunk.heading}` : ""}`, knowledgeApiPath(record.kind, record.id), chunk.contentText, record.tags.join(" "), authorityScore(record.authority ?? record.type), record.updatedAt ?? syncedAt),
      );
    }
    await this.database.batch(statements);
    const row = await this.database.prepare("SELECT * FROM knowledge_v2_items WHERE cache_key = ?").bind(key).first<ItemRow>();
    if (!row) throw new Error("Knowledge v2 cache write did not return the item");
    return mapItem(row);
  }

  async markDeleted(record: KnowledgeApiRecord, at: string): Promise<void> {
    const key = cacheKey(record);
    await this.database.prepare("UPDATE knowledge_v2_items SET stale = 1, deleted_at = COALESCE(deleted_at, ?), last_synced_at = ?, updated_at = COALESCE(updated_at, ?) WHERE cache_key = ?").bind(at, at, at, key).run();
  }

  async markFullReconciliationMissing(seenCacheKeys: readonly string[], at: string): Promise<void> {
    if (seenCacheKeys.length === 0) return;
    const placeholders = seenCacheKeys.map(() => "?").join(", ");
    await this.database.prepare(`UPDATE knowledge_v2_items SET stale = 1, deleted_at = COALESCE(deleted_at, ?), last_synced_at = ? WHERE cache_key NOT IN (${placeholders}) AND deleted_at IS NULL`).bind(at, at, ...seenCacheKeys).run();
  }

  async get(cacheKeyValue: string): Promise<KnowledgeV2CacheRecord | null> {
    const row = await this.database.prepare("SELECT * FROM knowledge_v2_items WHERE cache_key = ? AND deleted_at IS NULL LIMIT 1").bind(cacheKeyValue).first<ItemRow>();
    return row ? mapItem(row) : null;
  }

  async list(limit = 100): Promise<readonly KnowledgeV2CacheRecord[]> {
    const rows = await this.database.prepare("SELECT * FROM knowledge_v2_items WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?").bind(Math.min(Math.max(limit, 1), 500)).all<ItemRow>();
    return rows.results.map(mapItem);
  }

  async listMedia(limit = 120): Promise<readonly KnowledgeV2CacheRecord[]> {
    const rows = await this.database.prepare(
      "SELECT * FROM knowledge_v2_items WHERE deleted_at IS NULL AND stale = 0 AND (lower(kind) LIKE '%media%' OR lower(kind) IN ('screenshot', 'screenshots')) ORDER BY updated_at DESC LIMIT ?",
    ).bind(Math.min(Math.max(limit, 1), 200)).all<ItemRow>();
    return rows.results.map(mapItem);
  }

  async getByKindAndId(kind: string, itemId: string): Promise<KnowledgeV2CacheRecord | null> {
    const row = await this.database.prepare(
      "SELECT * FROM knowledge_v2_items WHERE kind = ? AND item_id = ? AND deleted_at IS NULL LIMIT 1",
    ).bind(kind, itemId).first<ItemRow>();
    return row ? mapItem(row) : null;
  }

  async getMediaById(itemId: string): Promise<KnowledgeV2CacheRecord | null> {
    const row = await this.database.prepare(
      "SELECT * FROM knowledge_v2_items WHERE item_id = ? AND deleted_at IS NULL AND (lower(kind) LIKE '%media%' OR lower(kind) IN ('screenshot', 'screenshots')) LIMIT 1",
    ).bind(itemId).first<ItemRow>();
    return row ? mapItem(row) : null;
  }

  async getState(): Promise<StateRow | null> {
    return this.database.prepare("SELECT * FROM knowledge_v2_sync_state WHERE state_key = 'default'").first<StateRow>();
  }

  async updateState(input: {
    readonly attemptedAt: string;
    readonly successfulAt?: string | null;
    readonly mode?: string | null;
    readonly fullSyncAt?: string | null;
    readonly incrementalSyncAt?: string | null;
    readonly cursor?: string | null;
    readonly manifest?: JsonObject;
    readonly counts?: JsonObject;
    readonly apiCalls?: number;
    readonly recordsChanged?: number;
    readonly error?: string | null;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO knowledge_v2_sync_state (state_key, last_attempted_at, last_successful_at, last_full_sync_at, last_incremental_sync_at, changes_cursor, last_mode, manifest_json, counts_json, api_calls, records_changed, last_error, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(state_key) DO UPDATE SET
         last_attempted_at = excluded.last_attempted_at,
         last_successful_at = COALESCE(excluded.last_successful_at, knowledge_v2_sync_state.last_successful_at),
         last_full_sync_at = COALESCE(excluded.last_full_sync_at, knowledge_v2_sync_state.last_full_sync_at),
         last_incremental_sync_at = COALESCE(excluded.last_incremental_sync_at, knowledge_v2_sync_state.last_incremental_sync_at),
         changes_cursor = COALESCE(excluded.changes_cursor, knowledge_v2_sync_state.changes_cursor),
         last_mode = excluded.last_mode,
         manifest_json = CASE WHEN excluded.manifest_json = '{}' THEN knowledge_v2_sync_state.manifest_json ELSE excluded.manifest_json END,
         counts_json = CASE WHEN excluded.counts_json = '{}' THEN knowledge_v2_sync_state.counts_json ELSE excluded.counts_json END,
         api_calls = knowledge_v2_sync_state.api_calls + excluded.api_calls,
         records_changed = knowledge_v2_sync_state.records_changed + excluded.records_changed,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
    ).bind(
      input.attemptedAt, input.successfulAt ?? null, input.fullSyncAt ?? null, input.incrementalSyncAt ?? null,
      input.cursor ?? null, input.mode ?? null, encodeObject(input.manifest, "knowledge_v2.manifest"),
      encodeObject(input.counts, "knowledge_v2.counts"), Math.max(0, input.apiCalls ?? 0), Math.max(0, input.recordsChanged ?? 0), input.error ?? null, input.attemptedAt,
    ).run();
  }

  async stats(): Promise<JsonObject> {
    const [counts, chunks, visibility, kinds, state] = await Promise.all([
      this.database.prepare("SELECT COUNT(*) AS count FROM knowledge_v2_items WHERE deleted_at IS NULL").first<{ count: number }>(),
      this.database.prepare("SELECT COUNT(*) AS count FROM knowledge_v2_chunks WHERE item_cache_key IN (SELECT cache_key FROM knowledge_v2_items WHERE deleted_at IS NULL)").first<{ count: number }>(),
      this.database.prepare("SELECT visibility, COUNT(*) AS count FROM knowledge_v2_items WHERE deleted_at IS NULL GROUP BY visibility").all<{ visibility: string; count: number }>(),
      this.database.prepare("SELECT kind, COUNT(*) AS count FROM knowledge_v2_items WHERE deleted_at IS NULL GROUP BY kind").all<{ kind: string; count: number }>(),
      this.getState(),
    ]);
    return {
      cachedItems: Number(counts?.count ?? 0),
      cachedChunks: Number(chunks?.count ?? 0),
      byVisibility: Object.fromEntries(visibility.results.map((row) => [row.visibility, Number(row.count)])),
      byKind: Object.fromEntries(kinds.results.map((row) => [row.kind, Number(row.count)])),
      state: state ? {
        lastAttemptedAt: state.last_attempted_at, lastSuccessfulAt: state.last_successful_at,
        lastFullSyncAt: state.last_full_sync_at, lastIncrementalSyncAt: state.last_incremental_sync_at,
        changesCursor: state.changes_cursor, lastMode: state.last_mode, apiCalls: state.api_calls,
        recordsChanged: state.records_changed, lastError: state.last_error,
        manifest: parseJson(state.manifest_json, {}), counts: parseJson(state.counts_json, {}),
      } : null,
    };
  }
}

export function knowledgeCacheKey(record: KnowledgeApiRecord): string { return cacheKey(record); }
