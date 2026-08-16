import { jsonResponse, methodNotAllowed } from "../src/api/http";
import { createRepositories } from "../src/database/repositories";
import { DocumentService } from "../src/memory/document-service";
import { ContextPackService, InstitutionalMemorySearch } from "../src/memory/retrieval";
import { KnowledgeSyncService } from "../src/knowledge/sync";
import { OFFICIAL_LUMA_SOURCES } from "../src/knowledge/sources";

interface Phase04SmokeEnvironment {
  readonly DB: D1Database;
  readonly SMOKE_SECRET: string;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4_096) throw new Error("request_body_too_large");
  if (raw.trim().length === 0) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("invalid_request");
  return parsed;
}

function textField(body: Record<string, unknown>, key: string, maximum = 200): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) throw new Error(`invalid_${key}`);
  return value.trim();
}

async function runDocumentSmoke(repositories: ReturnType<typeof createRepositories>): Promise<Record<string, unknown>> {
  const documents = new DocumentService(repositories);
  const runId = crypto.randomUUID().replaceAll("-", "");
  const productPath = `/agents/product/phase04-smoke-${runId}.md`;
  const sharedPath = `/shared/ideas/phase04-memory-smoke-${runId}.md`;
  const product = { agentId: "agent-product" } as const;
  const growth = { agentId: "agent-growth" } as const;
  const thread = (await repositories.threads.listActive(1))[0] ?? null;

  const created = await documents.create({
    actor: product, logicalPath: productPath, title: "Phase 04 product smoke", contentMarkdown: "# v1\nActivation hypothesis.", tags: ["phase04", "smoke"],
  });
  const readV1 = await documents.read(productPath, product);
  const edited = await documents.edit({ actor: product, logicalPath: productPath, contentMarkdown: "# v2\nA shorter activation path.", changeSummary: "Phase 04 smoke edit" });
  const history = await documents.history(productPath, product);
  const search = new InstitutionalMemorySearch(repositories.database);
  const foundBeforeDelete = await search.search("activation", { agentId: product.agentId, topK: 10 });
  await documents.delete(productPath, product);
  const foundAfterDelete = await search.search("activation", { agentId: product.agentId, topK: 10 });
  await documents.restore(productPath, product);
  const restored = await documents.read(productPath, product);

  const shared = await documents.create({
    actor: product, logicalPath: sharedPath, title: "Phase 04 shared smoke", contentMarkdown: "Shared idea for retrieval.", tags: ["phase04", "shared"],
  });
  const sharedReadByGrowth = await documents.read(sharedPath, growth);
  const sharedFoundByGrowth = await search.search("shared retrieval", { agentId: growth.agentId, topK: 10 });
  const reference = thread
    ? await documents.reference({ logicalPath: sharedPath, actor: product, threadId: thread.id, relation: "phase04_smoke", idempotencyKey: `phase04-smoke-reference:${runId}` })
    : null;

  // Archive the smoke documents reversibly. Their revisions and references remain auditable.
  await documents.delete(productPath, product);
  await documents.delete(sharedPath, product);

  return {
    runId,
    productPath,
    sharedPath,
    productDocumentId: created.document.id,
    sharedDocumentId: shared.document.id,
    initialVersion: readV1.document.currentVersion,
    editedVersion: edited.document.currentVersion,
    historyVersions: history.map((version) => version.versionNumber),
    foundBeforeDelete: foundBeforeDelete.some((item) => item.pathOrUrl === productPath),
    excludedAfterDelete: !foundAfterDelete.some((item) => item.pathOrUrl === productPath),
    restoredContent: restored.currentVersion?.contentMarkdown ?? null,
    sharedReadableByGrowth: sharedReadByGrowth.document.scope === "shared",
    sharedFoundByGrowth: sharedFoundByGrowth.some((item) => item.pathOrUrl === sharedPath),
    referenceCreated: reference !== null,
    archivedReversibly: true,
  };
}

export default {
  async fetch(request: Request, env: Phase04SmokeEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__luma_phase04/ready") {
      return request.method === "GET" ? jsonResponse({ ok: true }) : methodNotAllowed();
    }
    if (!url.pathname.startsWith("/__luma_phase04/")) return jsonResponse({ ok: false, error: "not_found" }, 404);
    if (request.method !== "POST") return methodNotAllowed();
    const suppliedSecret = request.headers.get("X-Luma-Smoke-Secret");
    if (suppliedSecret === null || !constantTimeEqual(suppliedSecret, env.SMOKE_SECRET)) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    try {
      const body = await readBody(request);
      const repositories = createRepositories(env.DB);
      if (url.pathname === "/__luma_phase04/sync") {
        const sourceKey = textField(body, "sourceKey", 80);
        if (!sourceKey || !OFFICIAL_LUMA_SOURCES.some((source) => source.key === sourceKey)) {
          return jsonResponse({ ok: false, error: "source_not_allowlisted" }, 400);
        }
        const now = new Date().toISOString();
        const job = await repositories.jobs.create({
          jobType: "knowledge.sync_source",
          payload: { sourceKey, source: "phase04_operator_smoke" },
          idempotencyKey: `phase04-smoke-sync:${sourceKey}:${crypto.randomUUID()}`,
          dueAt: now,
          priority: 30,
          maxAttempts: 1,
        });
        const leaseOwner = `phase04-smoke:${crypto.randomUUID()}`;
        const claimed = await repositories.jobs.claim(job.id, leaseOwner, 120, now);
        if (!claimed) return jsonResponse({ ok: false, error: "sync_job_not_claimable" }, 409);
        const result = await new KnowledgeSyncService(repositories).processJob(claimed);
        await repositories.jobs.complete(job.id, leaseOwner);
        return jsonResponse({ ok: true, jobId: job.id, result });
      }
      if (url.pathname === "/__luma_phase04/documents") {
        return jsonResponse({ ok: true, result: await runDocumentSmoke(repositories) });
      }
      if (url.pathname === "/__luma_phase04/search") {
        const query = textField(body, "query", 500);
        if (!query) return jsonResponse({ ok: false, error: "query_required" }, 400);
        const results = await new InstitutionalMemorySearch(repositories.database).search(query, {
          agentId: typeof body.agentId === "string" ? body.agentId : "agent-product",
          topK: 10,
        });
        return jsonResponse({ ok: true, query, results: results.map((result) => ({
          type: result.type, sourceId: result.sourceId, title: result.title, pathOrUrl: result.pathOrUrl,
          excerpt: result.excerpt, authority: result.authority, score: result.score, provenance: result.provenance,
        })) });
      }
      if (url.pathname === "/__luma_phase04/context") {
        const query = textField(body, "query", 500);
        if (!query) return jsonResponse({ ok: false, error: "query_required" }, 400);
        const threadId = typeof body.threadId === "string" ? body.threadId : (await repositories.threads.listActive(1))[0]?.id;
        const pack = await new ContextPackService(repositories.database).build({
          query, actor: { agentId: "agent-product" }, threadId, topK: 8, maxCharacters: 6_000,
        });
        return jsonResponse({ ok: true, threadId: threadId ?? null, totalCharacters: pack.totalCharacters, truncated: pack.truncated, items: pack.items.map((item) => ({
          type: item.type, sourceId: item.sourceId, title: item.title, pathOrUrl: item.pathOrUrl,
          excerpt: item.excerpt, authority: item.authority, score: item.score, updatedAt: item.updatedAt, provenance: item.provenance,
        })) });
      }
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    } catch (error: unknown) {
      return jsonResponse({ ok: false, error: error instanceof Error ? error.message.slice(0, 240) : "smoke_failed" }, 502);
    }
  },
};
