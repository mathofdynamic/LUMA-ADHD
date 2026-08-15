import type { DatabaseClient } from "../database/client";
import { requireLimit } from "../database/validation";
import { nowIso } from "../database/ids";
import type { MessageRecord } from "../database/types";
import { MemoryNoteRepository, DecisionRecordRepository, ThreadSummaryRepository } from "./repositories";
import type { ContextPack, ContextPackItem, MemoryActor, MemoryItemType } from "./types";

const MAX_QUERY_TERMS = 12;
const MAX_TERM_LENGTH = 80;
const MAX_EXCERPT_LENGTH = 700;
const FTS_OPERATORS = new Set(["AND", "NOT", "NEAR", "OR"]);

export interface RetrievalSearchOptions {
  readonly agentId?: string;
  readonly threadId?: string;
  readonly tags?: readonly string[];
  readonly topK?: number;
}

export interface RetrievalResult extends ContextPackItem {
  readonly matchedTerms: readonly string[];
}

export function normalizeFtsQuery(query: string): readonly string[] {
  if (typeof query !== "string") return [];
  const normalized = query.normalize("NFC").slice(0, 1_000);
  const terms = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(
    terms
      .map((term) => term.slice(0, MAX_TERM_LENGTH))
      .filter((term) => Boolean(term) && !FTS_OPERATORS.has(term.toUpperCase())),
  )].slice(0, MAX_QUERY_TERMS);
}

function ftsExpression(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replace(/"/gu, '""')}"`).join(" OR ");
}

function excerpt(content: string, terms: readonly string[]): string {
  const compact = content.replace(/\r\n?/gu, "\n").trim();
  if (compact.length <= MAX_EXCERPT_LENGTH) return compact;
  const lower = compact.toLocaleLowerCase();
  const index = terms
    .map((term) => lower.indexOf(term.toLocaleLowerCase()))
    .filter((position) => position >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, Math.min(index - 180, compact.length - MAX_EXCERPT_LENGTH));
  return `${start > 0 ? "…" : ""}${compact.slice(start, start + MAX_EXCERPT_LENGTH)}${start + MAX_EXCERPT_LENGTH < compact.length ? "…" : ""}`;
}

function itemType(sourceKind: string): MemoryItemType {
  if (sourceKind === "knowledge_chunk") return "knowledge_chunk";
  if (sourceKind === "thread_summary") return "thread_summary";
  if (sourceKind === "decision") return "decision";
  if (sourceKind === "memory_note") return "memory_note";
  if (sourceKind === "message") return "message";
  return "document";
}

interface SearchRow {
  source_kind: string;
  source_id: string;
  title: string;
  path_or_url: string | null;
  content_text: string;
  tags_text: string;
  authority: number;
  updated_at: string;
  thread_id: string | null;
  owner_agent_id: string | null;
  bm25_score: number;
}

export class InstitutionalMemorySearch {
  constructor(private readonly database: DatabaseClient) {}

  async search(query: string, options: RetrievalSearchOptions = {}): Promise<readonly RetrievalResult[]> {
    const terms = normalizeFtsQuery(query);
    if (terms.length === 0) return [];
    const topK = requireLimit(options.topK ?? 8, "retrieval topK", 50);
    const expression = ftsExpression(terms);
    const threadId = options.threadId ?? null;
    const agentId = options.agentId ?? null;
    const rows = await this.database.prepare(
      `SELECT f.source_kind, f.source_id, f.title, f.path_or_url, f.content_text,
              f.tags_text, f.authority, f.updated_at,
              COALESCE(d.thread_id, ts.thread_id, dr.thread_id, mn.thread_id, m.thread_id) AS thread_id,
              COALESCE(d.owner_agent_id, mn.agent_id) AS owner_agent_id,
              bm25(institutional_memory_fts) AS bm25_score
       FROM institutional_memory_fts f
       LEFT JOIN documents d ON f.source_kind = 'document' AND d.id = f.source_id
       LEFT JOIN knowledge_chunks kc ON f.source_kind = 'knowledge_chunk' AND kc.id = f.source_id
       LEFT JOIN knowledge_sources ks ON kc.source_id = ks.id
       LEFT JOIN thread_summaries ts ON f.source_kind = 'thread_summary' AND ts.id = f.source_id
       LEFT JOIN decision_records dr ON f.source_kind = 'decision' AND dr.id = f.source_id
       LEFT JOIN memory_notes mn ON f.source_kind = 'memory_note' AND mn.id = f.source_id
       LEFT JOIN messages m ON f.source_kind = 'message' AND m.id = f.source_id
       WHERE institutional_memory_fts MATCH ?
         AND (
           (f.source_kind = 'document' AND d.deleted_at IS NULL AND
             (d.scope = 'shared' OR d.owner_agent_id = ? OR EXISTS (
               SELECT 1 FROM document_shares ds
               WHERE ds.document_id = d.id AND ds.agent_id = ? AND ds.revoked_at IS NULL
             )))
           OR (f.source_kind = 'knowledge_chunk' AND ks.status <> 'archived' AND ks.normalized_content IS NOT NULL)
           OR (f.source_kind = 'message' AND m.deleted_at IS NULL AND m.visibility <> 'private'
             AND (? IS NULL OR m.thread_id = ?))
           OR (f.source_kind = 'thread_summary' AND ts.id IS NOT NULL
             AND (? IS NULL OR ts.thread_id = ?))
           OR (f.source_kind = 'decision' AND dr.id IS NOT NULL
             AND (? IS NULL OR dr.thread_id = ?))
           OR (f.source_kind = 'memory_note' AND mn.deleted_at IS NULL AND
             (mn.scope = 'organization' OR mn.agent_id = ? OR mn.thread_id = ?))
         )
       ORDER BY bm25_score ASC, f.authority DESC, f.updated_at DESC
       LIMIT ?`,
    ).bind(
      expression, agentId, agentId, threadId, threadId, threadId, threadId, threadId, threadId, agentId, threadId, topK * 6,
    ).all<SearchRow>();

    const asOf = Date.now();
    return rows.results
      .map((row) => {
        const ageDays = Math.max(0, (asOf - Date.parse(row.updated_at)) / 86_400_000);
        const textScore = 1 / (1 + Math.abs(Number(row.bm25_score) || 0));
        const authorityScore = Math.max(0, Math.min(1, row.authority / 100));
        const recencyScore = 1 / (1 + ageDays / 30);
        const threadBoost = options.threadId && row.thread_id === options.threadId ? 0.22 : 0;
        const ownerBoost = options.agentId && row.owner_agent_id === options.agentId ? 0.14 : 0;
        const tagBoost = options.tags?.some((tag) => row.tags_text.toLocaleLowerCase().includes(tag.toLocaleLowerCase())) ? 0.1 : 0;
        return {
          type: itemType(row.source_kind), sourceId: row.source_id, title: row.title,
          pathOrUrl: row.path_or_url, excerpt: excerpt(row.content_text, terms), authority: row.authority,
          score: textScore * 0.5 + authorityScore * 0.2 + recencyScore * 0.08 + threadBoost + ownerBoost + tagBoost,
          updatedAt: row.updated_at, threadId: row.thread_id, ownerAgentId: row.owner_agent_id,
          matchedTerms: terms, provenance: {
            sourceKind: row.source_kind, authority: row.authority, matchedTerms: terms.join(" "),
          },
        } satisfies RetrievalResult;
      })
      .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, topK);
  }
}

export class ContextPackService {
  private readonly searchService: InstitutionalMemorySearch;
  private readonly notes: MemoryNoteRepository;
  private readonly decisions: DecisionRecordRepository;
  private readonly summaries: ThreadSummaryRepository;

  constructor(private readonly database: DatabaseClient) {
    this.searchService = new InstitutionalMemorySearch(database);
    this.notes = new MemoryNoteRepository(database);
    this.decisions = new DecisionRecordRepository(database);
    this.summaries = new ThreadSummaryRepository(database);
  }

  async build(input: {
    readonly query: string;
    readonly actor?: MemoryActor;
    readonly threadId?: string;
    readonly recentMessages?: readonly MessageRecord[];
    readonly topK?: number;
    readonly maxCharacters?: number;
  }): Promise<ContextPack> {
    const maxCharacters = Math.max(1_000, Math.min(input.maxCharacters ?? 6_000, 12_000));
    const candidates: ContextPackItem[] = [];
    const summary = input.threadId ? await this.summaries.get(input.threadId) : null;
    if (summary) {
      candidates.push({
        type: "thread_summary", sourceId: summary.id, title: `Thread summary: ${summary.phaseKey}`,
        pathOrUrl: null, excerpt: excerpt(summary.summaryMarkdown, normalizeFtsQuery(input.query)), authority: 80,
        score: 1.2, updatedAt: summary.updatedAt, threadId: summary.threadId, ownerAgentId: null,
        provenance: { sourceKind: "thread_summary", phaseKey: summary.phaseKey, version: summary.currentVersion },
      });
    }
    if (input.threadId) {
      const decisions = await this.decisions.listForThread(input.threadId, 3);
      candidates.push(...decisions.map((decision) => ({
        type: "decision" as const, sourceId: decision.id, title: decision.title, pathOrUrl: null,
        excerpt: excerpt(`${decision.decisionText}\n${decision.rationale ?? ""}`, normalizeFtsQuery(input.query)),
        authority: 85, score: 1.05, updatedAt: decision.updatedAt, threadId: decision.threadId, ownerAgentId: decision.decidedByAgentId,
        provenance: { sourceKind: "decision", status: decision.status },
      })));
    }
    const recentMessages = (input.recentMessages ?? []).filter((message) => message.visibility !== "private");
    candidates.push(...recentMessages.slice(-4).map((message) => ({
      type: "message" as const,
      sourceId: message.id,
      title: message.authorAgentId ?? message.authorUserId ?? message.authorType,
      pathOrUrl: null,
      excerpt: excerpt(message.contentText, normalizeFtsQuery(input.query)),
      authority: message.authorType === "agent" ? 60 : 50,
      score: 1.1,
      updatedAt: message.createdAt,
      threadId: message.threadId,
      ownerAgentId: message.authorAgentId,
      provenance: { sourceKind: "message", origin: message.origin },
    })));
    const notes = await this.notes.listForContext({ agentId: input.actor?.agentId, threadId: input.threadId, limit: 3 });
    candidates.push(...notes.map((note) => ({
      type: "memory_note" as const, sourceId: note.id, title: note.title, pathOrUrl: null,
      excerpt: excerpt(note.contentText, normalizeFtsQuery(input.query)), authority: note.scope === "organization" ? 75 : 55,
      score: 0.95, updatedAt: note.updatedAt, threadId: note.threadId, ownerAgentId: note.agentId,
      provenance: { sourceKind: "memory_note", scope: note.scope, importance: note.importance },
    })));
    const retrieved = await this.searchService.search(input.query, {
      agentId: input.actor?.agentId, threadId: input.threadId, topK: input.topK ?? 8,
    });
    candidates.push(...retrieved);
    const deduped = [...new Map(candidates.map((item) => [`${item.type}:${item.sourceId}`, item])).values()]
      .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt));
    const items: ContextPackItem[] = [];
    let totalCharacters = 0;
    let truncated = false;
    for (const item of deduped) {
      const cost = item.excerpt.length + item.title.length + 80;
      if (totalCharacters + cost > maxCharacters) {
        truncated = true;
        continue;
      }
      items.push(item);
      totalCharacters += cost;
    }
    return { query: input.query, items, totalCharacters, truncated };
  }

  static toPromptText(pack: ContextPack): string {
    if (pack.items.length === 0) return "none";
    return pack.items.map((item, index) => {
      const provenance = item.pathOrUrl ?? item.provenance.sourceKind ?? item.type;
      return `${index + 1}. [${item.type}; authority=${item.authority}; score=${item.score.toFixed(3)}; source=${provenance}] ${item.title}\n${item.excerpt}`;
    }).join("\n\n");
  }
}

export function retrievalNow(): string {
  return nowIso();
}
