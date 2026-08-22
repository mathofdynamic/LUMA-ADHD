import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createRepositories } from "../src/database";
import { KnowledgeApiError, LumaKnowledgeClient, normalizeKnowledgeRecord, type KnowledgeApiRecord } from "../src/knowledge/client";
import { KnowledgeV2Repository } from "../src/knowledge/v2-repository";
import { KnowledgeV2Service } from "../src/knowledge/v2-service";
import { ContextPackService } from "../src/memory/retrieval";

const repositories = createRepositories(env.DB);

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function record(input: Partial<KnowledgeApiRecord> & Pick<KnowledgeApiRecord, "id" | "kind" | "title">): KnowledgeApiRecord {
  return {
    category: null, type: "OFFICIAL_FACT", visibility: "PUBLIC", language: "en", status: "current", authority: "OFFICIAL_FACT",
    owner: null, summary: null, contentText: null, structured: {}, tags: [], sourceUrl: null,
    updatedAt: "2026-08-22T10:00:00.000Z", createdAt: "2026-08-20T10:00:00.000Z", reviewAfter: null,
    contentHash: null, versionMarker: null, deleted: false, ...input,
  };
}

function imageResponse(): Response {
  return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
    status: 200,
    headers: { "content-type": "image/png", "content-length": "8" },
  });
}

describe("LUMA Knowledge v2 client boundaries", () => {
  it("uses the authenticated API path, paginates, and normalizes records", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const client = new LumaKnowledgeClient({
      baseUrl: "https://knowledge.test/api/v1",
      token: "test-token",
      fetcher: async (input, init) => {
        const url = String(input);
        calls.push({ url, headers: new Headers(init?.headers) });
        if (url.includes("cursor=next")) return jsonResponse({ items: [{ id: "second", kind: "person", name: "Second" }] });
        return jsonResponse({ items: [{ id: "first", kind: "item", title: "First" }], pagination: { next_cursor: "next" } });
      },
    });

    const items = await client.listItems();
    expect(items.map((item) => item.id)).toEqual(["first", "second"]);
    expect(calls[0]?.url).toBe("https://knowledge.test/api/v1/items?limit=100");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
  });

  it("distinguishes authorization failures without falling back anonymously", async () => {
    const client = new LumaKnowledgeClient({
      baseUrl: "https://knowledge.test/api/v1",
      token: "test-token",
      fetcher: async () => jsonResponse({ error: "forbidden" }, 403),
    });

    await expect(client.manifest()).rejects.toMatchObject<Partial<KnowledgeApiError>>({ category: "forbidden", status: 403, retryable: false });
  });

  it("strips Knowledge authorization before an approved provider fetch", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const client = new LumaKnowledgeClient({
      baseUrl: "https://knowledge.test/api/v1",
      token: "test-token",
      fetcher: async (input, init) => {
        const url = String(input);
        calls.push({ url, headers: new Headers(init?.headers) });
        return url.includes("/content")
          ? new Response(null, { status: 302, headers: { location: "https://cdn.uploadthing.com/current.png" } })
          : imageResponse();
      },
    });

    const response = await client.getMediaContent("media-1");
    expect(response.ok).toBe(true);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(calls[1]?.headers.get("authorization")).toBeNull();
    expect(calls[1]?.url).toBe("https://cdn.uploadthing.com/current.png");
  });

  it("rejects an arbitrary media redirect before fetching it", async () => {
    let providerFetched = false;
    const client = new LumaKnowledgeClient({
      baseUrl: "https://knowledge.test/api/v1",
      token: "test-token",
      fetcher: async (input) => {
        if (String(input).includes("/content")) return new Response(null, { status: 302, headers: { location: "https://evil.example/image.png" } });
        providerFetched = true;
        return imageResponse();
      },
    });

    await expect(client.getMediaContent("media-unsafe")).rejects.toMatchObject({ category: "malformed" });
    expect(providerFetched).toBe(false);
  });

  it("does not retain bearer or signed media URLs from remote metadata", () => {
    const normalized = normalizeKnowledgeRecord({
      id: "media-secret",
      kind: "media",
      title: "Screenshot",
      url: "https://cdn.example.test/current.png?token=secret-value&expires=999",
      structured: { providerUrl: "https://cdn.example.test/current.png?sig=private-signature" },
      note: "Authorization: Bearer hidden-token",
    });
    expect(normalized?.sourceUrl).toBe("[redacted-url]");
    expect(JSON.stringify(normalized?.structured)).not.toContain("private-signature");
    expect(JSON.stringify(normalized)).not.toContain("hidden-token");
  });
});

describe("LUMA Knowledge v2 derived cache and retrieval", () => {
  const baseRecords = {
    items: [record({ id: "product-workflow", kind: "item", title: "Workflow", summary: "Current workflow capability and pricing context.", tags: ["workflow", "product"] })],
    documents: [record({ id: "strategy-proposal", kind: "document", title: "Future strategy proposal", type: "PROPOSAL", visibility: "INTERNAL", contentText: "A future proposal that is not current operational data." })],
    people: [record({ id: "person-mahsa", kind: "person", title: "Mahsa", type: "PERSON", visibility: "MANAGEMENT", structured: { role: "Finance" } })],
    entities: [record({ id: "entity-luma", kind: "entity", title: "LUMA", type: "ORGANIZATION", visibility: "PUBLIC" })],
    media: [record({ id: "media-dashboard", kind: "media", title: "Current dashboard", type: "SCREENSHOT", visibility: "PUBLIC", structured: { pageId: "dashboard", viewport: "desktop", captureDate: "2026-08-21" } })],
  } as const;

  function fixtureFetcher(state: { fail?: boolean; incremental?: boolean }): typeof fetch {
    return async (input) => {
      const url = String(input);
      if (state.fail) throw new Error("offline");
      if (url.endsWith("/manifest")) return jsonResponse({ total: 5, visibility: ["PUBLIC", "INTERNAL", "MANAGEMENT"] });
      if (url.includes("/changes?")) return jsonResponse({ changes: state.incremental ? [baseRecords.people[0]] : [] });
      if (url.endsWith("/items?limit=100")) return jsonResponse({ items: baseRecords.items });
      if (url.endsWith("/documents?limit=100")) return jsonResponse({ items: baseRecords.documents });
      if (url.endsWith("/people?limit=100")) return jsonResponse({ items: baseRecords.people });
      if (url.endsWith("/entities?limit=100")) return jsonResponse({ items: baseRecords.entities });
      if (url.endsWith("/media?limit=100")) return jsonResponse({ items: baseRecords.media });
      if (url.endsWith("/documents/strategy-proposal")) return jsonResponse({ document: baseRecords.documents[0] });
      if (url.endsWith("/people/person-mahsa")) return jsonResponse({ person: baseRecords.people[0] });
      if (url.endsWith("/entities/entity-luma")) return jsonResponse({ entity: baseRecords.entities[0] });
      if (url.endsWith("/media/media-dashboard")) return jsonResponse({ media: baseRecords.media[0] });
      if (url.endsWith("/items/product-workflow")) return jsonResponse({ item: baseRecords.items[0] });
      if (url.includes("/media/media-dashboard/content")) return imageResponse();
      return jsonResponse({ items: [] });
    };
  }

  it("bootstraps structured kinds, chunks documents, and exposes provenance", async () => {
    const client = new LumaKnowledgeClient({ baseUrl: "https://knowledge.test/api/v1", token: "test-token", fetcher: fixtureFetcher({}) });
    const service = new KnowledgeV2Service(new KnowledgeV2Repository(repositories.database), client, () => "2026-08-22T12:00:00.000Z");
    const result = await service.sync("full");
    expect(result).toMatchObject({ mode: "full", records: 5 });
    const stats = await new KnowledgeV2Repository(repositories.database).stats();
    expect(stats.cachedItems).toBeGreaterThanOrEqual(5);
    expect(recordValue(stats.byVisibility, "MANAGEMENT")).toBeGreaterThanOrEqual(1);
    const pack = await new ContextPackService(repositories.database).build({ query: "What is the current Workflow product?", topK: 6, maxCharacters: 4_000 });
    const workflow = pack.items.find((item) => item.provenance.knowledgeItemId === "product-workflow");
    expect(workflow?.type).toBe("knowledge_v2_item");
    expect(workflow?.provenance.visibility).toBe("PUBLIC");
    expect(workflow?.pathOrUrl).toBe("/api/v1/items/product-workflow");
  });

  it("preserves the last-good cache when the Knowledge API fails", async () => {
    const client = new LumaKnowledgeClient({ baseUrl: "https://knowledge.test/api/v1", token: "test-token", fetcher: fixtureFetcher({ fail: true }) });
    const service = new KnowledgeV2Service(new KnowledgeV2Repository(repositories.database), client, () => "2026-08-22T12:05:00.000Z");
    await expect(service.sync("full")).rejects.toBeInstanceOf(KnowledgeApiError);
    const state = await new KnowledgeV2Repository(repositories.database).getState();
    expect(state?.last_successful_at).toBe("2026-08-22T12:00:00.000Z");
    expect(state?.last_error).toBe("network");
    expect(await new KnowledgeV2Repository(repositories.database).get("item:product-workflow")).not.toBeNull();
  });

  it("fetches validated media ephemerally without putting bytes in the cache", async () => {
    const client = new LumaKnowledgeClient({ baseUrl: "https://knowledge.test/api/v1", token: "test-token", fetcher: fixtureFetcher({}) });
    const service = new KnowledgeV2Service(new KnowledgeV2Repository(repositories.database), client);
    const image = await service.fetchMediaDataUrl("media-dashboard");
    expect(image.mimeType).toBe("image/png");
    expect(image.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    const row = await repositories.database.prepare("SELECT content_text, structured_json FROM knowledge_v2_items WHERE item_id = ?").bind("media-dashboard").first<{ content_text: string | null; structured_json: string }>();
    expect(row?.content_text ?? "").not.toContain("data:image");
    expect(row?.structured_json ?? "").not.toContain("base64");
  });

  it("reuses one bounded live evidence search across Agents", async () => {
    let searchCalls = 0;
    const client = new LumaKnowledgeClient({
      baseUrl: "https://knowledge.test/api/v1",
      token: "test-token",
      fetcher: async (input) => {
        if (String(input).includes("/search?")) { searchCalls += 1; return jsonResponse({ items: [baseRecords.items[0]] }); }
        return fixtureFetcher({})(input);
      },
    });
    const service = new KnowledgeV2Service(new KnowledgeV2Repository(repositories.database), client);
    await service.searchForContext({ query: "current workflow", agentId: "agent-product", currentState: true });
    await service.searchForContext({ query: "current workflow", agentId: "agent-finance", currentState: true });
    expect(searchCalls).toBe(1);
  });
});

function recordValue(value: unknown, key: string): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return 0;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "number" ? item : 0;
}
