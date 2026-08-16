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
  readonly sourceKinds?: readonly MemoryItemType[];
}

export type RetrievalIntent = "official_factual" | "discussion" | "workspace" | "mixed";

const SEARCHABLE_SOURCE_KINDS: readonly MemoryItemType[] = [
  "document", "knowledge_chunk", "message", "thread_summary", "decision", "memory_note",
];

export function classifyRetrievalIntent(query: string): RetrievalIntent {
  const normalized = query.normalize("NFC").toLocaleLowerCase();
  const official = /(?:\b(?:luma|pricing|subscription|workflow|capabilit(?:y|ies)|terms|video)\b|\u0644\u0648\u0645\u0627|\u0642\u06cc\u0645\u062a|\u0627\u0634\u062a\u0631\u0627\u06a9|\u0648\u0631\u06a9\u200c?\u0641\u0644\u0648|\u0642\u0627\u0628\u0644\u06cc\u062a|\u0627\u0628\u0632\u0627\u0631|\u0642\u0648\u0627\u0646\u06cc\u0646|\u0634\u0631\u0627\u06cc\u0637|\u0648\u06cc\u062f\u06cc\u0648|\u0686\u06cc\u0633\u062a|\u0686\u06cc\u0647)/u.test(normalized);
  const discussion = /(?:\b(?:thread|discussion|proposal|risk|continue|reply|decision)\b|\u0627\u06cc\u0646\s+\u0628\u062d\u062b|\u067e\u06cc\u0634\u0646\u0647\u0627\u062f|\u0631\u06cc\u0633\u06a9|\u0627\u062f\u0627\u0645\u0647|\u062a\u0635\u0645\u06cc\u0645)/u.test(normalized);
  if (official && discussion) return "mixed";
  if (official) return "official_factual";
  if (discussion) return "discussion";
  return "workspace";
}

export interface RetrievalResult extends ContextPackItem {
  readonly matchedTerms: readonly string[];
}

export function normalizeFtsQuery(query: string): readonly string[] {
  if (typeof query !== "string") return [];
  const normalized = query.normalize("NFC").slice(0, 1_000);
  const terms = normalized.match(/[\p{L}\p{N}_\u200c\u200d]+/gu) ?? [];
  const expandedTerms = terms.flatMap((term) => {
    const joined = term.replace(/[\u200c\u200d]/gu, "");
    const components = term.split(/[\u200c\u200d]/gu).filter(Boolean);
    return [joined, ...components];
  });
  return [...new Set(
    expandedTerms
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
  document_scope: string | null;
  knowledge_url: string | null;
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
    const sourceKinds = [...new Set(options.sourceKinds ?? SEARCHABLE_SOURCE_KINDS)];
    if (sourceKinds.length === 0) return [];
    if (sourceKinds.some((kind) => !SEARCHABLE_SOURCE_KINDS.includes(kind))) {
      throw new Error("retrieval source kind is not supported");
    }
    const sourceClause = `AND f.source_kind IN (${sourceKinds.map(() => "?").join(", ")})`;
    const rows = await this.database.prepare(
      `SELECT f.source_kind, f.source_id, f.title, f.path_or_url, f.content_text,
              f.tags_text, f.authority, f.updated_at,
              COALESCE(d.thread_id, ts.thread_id, dr.thread_id, mn.thread_id, m.thread_id) AS thread_id,
              COALESCE(d.owner_agent_id, mn.agent_id) AS owner_agent_id,
              d.scope AS document_scope,
              ks.uri AS knowledge_url,
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
         ${sourceClause}
         AND (
           (f.source_kind = 'document' AND d.deleted_at IS NULL AND
             (d.scope = 'shared' OR d.owner_agent_id = ? OR EXISTS (
               SELECT 1 FROM document_shares ds
               WHERE ds.document_id = d.id AND ds.agent_id = ? AND ds.revoked_at IS NULL
             ) OR (d.scope = 'thread' AND d.thread_id = ?)))
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
      expression, ...sourceKinds, agentId, agentId, threadId, threadId, threadId, threadId, threadId, threadId, threadId, agentId, threadId, topK * 6,
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
          pathOrUrl: row.path_or_url ?? row.knowledge_url, excerpt: excerpt(row.content_text, terms), authority: row.authority,
          score: textScore * 0.5 + authorityScore * 0.2 + recencyScore * 0.08 + threadBoost + ownerBoost + tagBoost,
          updatedAt: row.updated_at, threadId: row.thread_id, ownerAgentId: row.owner_agent_id,
          matchedTerms: terms, provenance: {
            sourceKind: row.source_kind, authority: row.authority, matchedTerms: terms.join(" "),
            ...(row.knowledge_url ? { sourceUrl: row.knowledge_url } : {}),
            ...(row.document_scope ? { scope: row.document_scope } : {}),
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
    const queryIntent = classifyRetrievalIntent(input.query);
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
    const topK = input.topK ?? 8;
    const retrieved = await this.searchService.search(input.query, {
      agentId: input.actor?.agentId,
      threadId: input.threadId,
      topK: Math.min(16, Math.max(1, topK * 2)),
      sourceKinds: ["document", "message", "thread_summary", "decision", "memory_note"],
    });
    const official = await this.searchService.search(input.query, {
      agentId: input.actor?.agentId,
      threadId: input.threadId,
      topK: Math.min(8, Math.max(1, topK)),
      sourceKinds: ["knowledge_chunk"],
    });
    candidates.push(...retrieved, ...official);
    const deduped = [...new Map(candidates.map((item) => [`${item.type}:${item.sourceId}`, item])).values()]
      .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt));
    const category = (item: ContextPackItem): "official" | "thread" | "workspace" | "supporting" => {
      if (item.type === "knowledge_chunk") return "official";
      if (item.type === "thread_summary" || item.type === "message" || item.type === "decision") return "thread";
      if (item.type === "document" || item.type === "memory_note") return "workspace";
      return "supporting";
    };
    const caps: Record<ReturnType<typeof category>, number> = {
      official: Math.floor(maxCharacters * (queryIntent === "official_factual" ? 0.55 : queryIntent === "mixed" ? 0.42 : 0.24)),
      thread: Math.floor(maxCharacters * (queryIntent === "discussion" ? 0.52 : queryIntent === "mixed" ? 0.36 : 0.28)),
      workspace: Math.floor(maxCharacters * (queryIntent === "workspace" ? 0.48 : 0.34)),
      supporting: Math.floor(maxCharacters * 0.24),
    };
    const orderedCategories: readonly ReturnType<typeof category>[] = queryIntent === "official_factual"
      ? ["official", "thread", "workspace", "supporting"]
      : queryIntent === "discussion"
        ? ["thread", "official", "workspace", "supporting"]
        : ["official", "workspace", "thread", "supporting"];
    const items: ContextPackItem[] = [];
    const selected = new Set<string>();
    const categoryCharacters = new Map<ReturnType<typeof category>, number>();
    let totalCharacters = 0;
    let truncated = false;
    const add = (item: ContextPackItem, respectCap: boolean): boolean => {
      const key = `${item.type}:${item.sourceId}`;
      if (selected.has(key)) return false;
      const cost = item.excerpt.length + item.title.length + 80;
      const kind = category(item);
      const used = categoryCharacters.get(kind) ?? 0;
      if (totalCharacters + cost > maxCharacters || (respectCap && used > 0 && used + cost > (caps[kind] ?? maxCharacters))) {
        truncated = true;
        return false;
      }
      selected.add(key);
      items.push(item);
      totalCharacters += cost;
      categoryCharacters.set(kind, used + cost);
      return true;
    };
    for (const kind of orderedCategories) {
      for (const item of deduped.filter((candidate) => category(candidate) === kind)) add(item, true);
    }
    for (const item of deduped) add(item, false);
    const sourceTypeCounts: Record<string, number> = {};
    let officialKnowledgeCount = 0;
    let agentDocumentCount = 0;
    let sharedDocumentCount = 0;
    for (const item of items) {
      sourceTypeCounts[item.type] = (sourceTypeCounts[item.type] ?? 0) + 1;
      if (item.type === "knowledge_chunk") officialKnowledgeCount += 1;
      if (item.type === "document") {
        const scope = item.provenance.scope;
        if (scope === "shared") sharedDocumentCount += 1;
        else agentDocumentCount += 1;
      }
    }
    return {
      query: input.query,
      items,
      totalCharacters,
      truncated,
      telemetry: {
        queryIntent,
        retrievalCount: items.length,
        sourceTypeCounts,
        officialKnowledgeCount,
        agentDocumentCount,
        sharedDocumentCount,
        totalRetrievedCharacters: items.reduce((sum, item) => sum + item.excerpt.length, 0),
        contextTruncated: truncated,
        acquisitionOperations: 0,
        selectedSources: items.slice(0, 16).map((item) => ({
          type: item.type,
          sourceId: item.sourceId,
          title: item.title,
          pathOrUrl: item.pathOrUrl,
          authority: item.authority,
        })),
      },
    };
  }

  static toPromptText(pack: ContextPack): string {
    if (pack.items.length === 0) return "none";
    return pack.items.map((item, index) => {
      const provenance = item.type === "knowledge_chunk"
        ? "official_luma_knowledge"
        : item.pathOrUrl ?? item.provenance.sourceKind ?? item.type;
      return `${index + 1}. [${item.type}; authority=${item.authority}; score=${item.score.toFixed(3)}; source=${provenance}] ${item.title}\n${item.excerpt}`;
    }).join("\n\n");
  }
}

export function retrievalNow(): string {
  return nowIso();
}
