import type { createRepositories } from "../database/repositories";
import { createId, nowIso } from "../database/ids";
import { ValidationError } from "../database/errors";
import type { JobRecord } from "../database/types";
import { sha256Hex } from "./util";
import { chunkMarkdown, markdownTitle, normalizeMarkdown } from "./markdown";
import { OFFICIAL_LUMA_SOURCES, officialSourceByKey } from "./sources";
import type { KnowledgeSyncResult } from "../memory/types";

const MAX_SOURCE_BYTES = 1_000_000;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;

type Repositories = ReturnType<typeof createRepositories>;

export interface KnowledgeSyncServiceOptions {
  readonly fetcher?: typeof fetch;
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_SOURCE_BYTES) throw new Error("source exceeds bounded response size");
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_SOURCE_BYTES) throw new Error("source exceeds bounded response size");
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
    if (bytes > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("source exceeds bounded response size");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

function nextRefreshAt(timestamp: string): string {
  return new Date(Date.parse(timestamp) + REFRESH_INTERVAL_MS).toISOString();
}

export class KnowledgeSyncService {
  private readonly fetcher: typeof fetch;
  private readonly now: () => string;
  private readonly timeoutMs: number;

  constructor(private readonly repositories: Repositories, options: KnowledgeSyncServiceOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? nowIso;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async ensureOfficialSources(): Promise<void> {
    await this.repositories.knowledgeSources.ensureOfficialSources(OFFICIAL_LUMA_SOURCES);
  }

  async syncSource(key: string): Promise<KnowledgeSyncResult> {
    const definition = officialSourceByKey(key);
    if (!definition) throw new ValidationError("knowledge source is not on the official LUMA allowlist");
    await this.ensureOfficialSources();
    const source = await this.repositories.knowledgeSources.getByKey(definition.canonicalKey);
    if (!source || source.uri !== definition.url) throw new ValidationError("configured knowledge source URL does not match the allowlist");
    const attemptedAt = this.now();
    await this.repositories.events.append({
      eventType: "knowledge_sync_started", aggregateType: "knowledge_source", aggregateId: source.id,
      idempotencyKey: `knowledge-sync-started:${source.id}:${attemptedAt}`, payload: { key },
    });
    const headers = new Headers();
    if (source.etag) headers.set("If-None-Match", source.etag);
    if (source.lastModified) headers.set("If-Modified-Since", source.lastModified);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(definition.url, { method: "GET", headers, redirect: "error", signal: controller.signal });
      if (response.status === 304) {
        const updated = await this.repositories.knowledgeSources.updateSyncState({
          sourceId: source.id, status: "active", attemptedAt, successfulAt: attemptedAt,
          nextRefreshAt: nextRefreshAt(attemptedAt), etag: source.etag, lastModified: source.lastModified,
        });
        await this.repositories.events.append({
          eventType: "knowledge_sync_unchanged", aggregateType: "knowledge_source", aggregateId: source.id,
          idempotencyKey: `knowledge-sync-unchanged:${source.id}:${attemptedAt}`, payload: { key, contentHash: updated.contentHash },
        });
        return { sourceKey: key, status: "unchanged", chunksCreated: 0, contentHash: updated.contentHash };
      }
      if (!response.ok) throw new Error(`official source returned HTTP ${response.status}`);
      const responseUrl = response.url;
      if (responseUrl && responseUrl !== definition.url) throw new Error("official source response URL changed unexpectedly");
      const normalized = normalizeMarkdown(await readBoundedText(response));
      if (!normalized) throw new Error("official source returned empty Markdown");
      const hash = await sha256Hex(normalized);
      const etag = response.headers.get("etag");
      const lastModified = response.headers.get("last-modified");
      if (source.contentHash === hash && source.normalizedContent !== null) {
        await this.repositories.knowledgeSources.updateSyncState({
          sourceId: source.id, status: "active", attemptedAt, successfulAt: attemptedAt,
          nextRefreshAt: nextRefreshAt(attemptedAt), etag, lastModified, errorSummary: null,
        });
        await this.repositories.events.append({
          eventType: "knowledge_sync_unchanged", aggregateType: "knowledge_source", aggregateId: source.id,
          idempotencyKey: `knowledge-sync-unchanged:${source.id}:${hash}`, payload: { key, contentHash: hash },
        });
        return { sourceKey: key, status: "unchanged", chunksCreated: 0, contentHash: hash };
      }

      const logicalPath = `/shared/research/luma-${definition.slug}.md`;
      const document = source.documentId
        ? await this.repositories.documents.getWithCurrentVersion(source.documentId)
        : null;
      const currentDocument = document ?? await this.repositories.documents.create({
        scope: "shared", logicalPath, title: markdownTitle(normalized, definition.title),
        initialContent: normalized, tags: ["official", "luma", definition.key],
        metadata: { official: true, sourceUrl: definition.url, sourceKey: definition.key },
        changeSummary: "Initial official LUMA source cache",
      });
      if (!source.documentId) await this.repositories.knowledgeSources.setDocumentId(source.id, currentDocument.document.id);
      let documentVersionId = currentDocument.currentVersion?.id;
      if (document && document.currentVersion?.contentMarkdown !== normalized) {
        const revision = await this.repositories.documents.appendRevision({
          documentId: currentDocument.document.id, contentMarkdown: normalized,
          changeSummary: "Updated official LUMA source cache", checksum: hash,
        });
        documentVersionId = revision.id;
      }
      const chunks = chunkMarkdown(normalized).map((chunk) => ({
        id: `knowledge-chunk:${definition.slug}:${hash.slice(0, 16)}:${chunk.ordinal}`,
        documentVersionId,
        ordinal: chunk.ordinal, heading: chunk.heading ?? undefined, headingPath: chunk.headingPath ?? undefined,
        contentText: chunk.contentText, contentHash: hash,
        tokenEstimate: Math.ceil(chunk.contentText.length / 4), metadata: { official: true, sourceUrl: definition.url },
      }));
      const storedChunks = await this.repositories.knowledgeSources.replaceChunks(source.id, chunks);
      await this.repositories.knowledgeSources.updateSyncState({
        sourceId: source.id, status: "active", attemptedAt, successfulAt: attemptedAt,
        nextRefreshAt: nextRefreshAt(attemptedAt), etag, lastModified, normalizedContent: normalized,
        contentHash: hash, errorSummary: null, incrementVersion: true,
      });
      await this.repositories.events.append({
        eventType: "knowledge_sync_updated", aggregateType: "knowledge_source", aggregateId: source.id,
        idempotencyKey: `knowledge-sync-updated:${source.id}:${hash}`, payload: { key, contentHash: hash, chunks: storedChunks.length, previousVersion: currentDocument.document.currentVersion },
      });
      return { sourceKey: key, status: "updated", chunksCreated: storedChunks.length, contentHash: hash };
    } catch (error: unknown) {
      const summary = error instanceof DOMException && error.name === "AbortError"
        ? "bounded fetch timeout"
        : String(error).slice(0, 240);
      await this.repositories.knowledgeSources.updateSyncState({
        sourceId: source.id, status: "failed", attemptedAt, nextRefreshAt: nextRefreshAt(attemptedAt), errorSummary: summary,
      });
      await this.repositories.events.append({
        eventType: "knowledge_sync_failed", aggregateType: "knowledge_source", aggregateId: source.id,
        idempotencyKey: `knowledge-sync-failed:${source.id}:${attemptedAt}`, payload: { key, error: summary },
      });
      return { sourceKey: key, status: "failed", chunksCreated: 0, contentHash: source.contentHash, errorSummary: summary };
    } finally {
      clearTimeout(timer);
    }
  }

  async processJob(job: JobRecord): Promise<KnowledgeSyncResult | null> {
    if (job.jobType !== "knowledge.sync_source") return null;
    const value = job.payload.sourceKey;
    if (typeof value !== "string") throw new ValidationError("knowledge sync job is missing sourceKey");
    return this.syncSource(value);
  }
}
