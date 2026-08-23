# LUMA Knowledge v2 integration

LUMA ADHD treats `https://luma-knowledge.pages.dev/api/v1` as the authoritative, read-only organizational knowledge layer for LUMA facts, products, people, entities, decisions, strategy, operations, and curated media.

## Ownership and cache

- ADHD D1 remains canonical for conversations, jobs, Agent memory, files, reputation, and operational state.
- LUMA Knowledge remains canonical for LUMA organizational records.
- `knowledge_v2_*` tables are a replaceable derived cache and FTS index. They are not a write-back store.
- The older twelve Markdown sources remain a narrow compatibility fallback. When the v2 token is configured, scheduled sync uses v2 and does not create one job per legacy source.

The cache stores bounded metadata, structured fields, document text/chunks, provenance, visibility, freshness, and content hashes. It never stores screenshot bytes, base64, signed provider URLs, or Knowledge bearer tokens.

## API and synchronization

`LumaKnowledgeClient` is server-side only. It authenticates with `LUMA_KNOWLEDGE_API_TOKEN` and defaults to the canonical base URL; `LUMA_KNOWLEDGE_BASE_URL` is a non-secret override for controlled environments.

The first bounded reconciliation reads the manifest and paginated items, documents, people, entities, and media catalogs. Document detail is fetched only when list content is incomplete. Later jobs use `/changes?since=...`, which is an updated-at snapshot rather than a complete revision log. Periodic full reconciliation handles catalog drift and removals. Last-good cache entries survive API timeout, outage, malformed responses, and temporary provider errors.

All requests have bounded time and response size. The client accepts conditional JSON responses when the API supplies ETag or Last-Modified. A `401` or `403` is a configuration/security incident; the application never falls back anonymously.

## Visibility, authority, and freshness

The ADHD service identity has `knowledge:read:management`. Only `PUBLIC`, `INTERNAL`, and `MANAGEMENT` records are cached or retrieved. `RESTRICTED` is never inserted into the cache or prompt context.

Retrieved records retain:

- Knowledge item ID and kind;
- type/epistemic class such as `OFFICIAL_FACT`, `CURRENT_OPERATIONAL_DATA`, `DECISION`, `PROPOSAL`, `HYPOTHESIS`, or `HISTORICAL`;
- authority, visibility, owner, status, updated time, review time, and source API path.

Current operational data, explicit current decisions, and canonical current facts outrank older research, proposals, hypotheses, and historical records. A proposal or hypothesis cannot establish a current priority by itself. Conflicts remain visible in provenance rather than being silently merged. Human conversation can be newer than the cache; it is treated as current conversational evidence without mutating Knowledge automatically.

## Retrieval

Local D1 FTS is the first retrieval layer. Structured authority, visibility, recency, thread, ownership, and tag signals affect ranking. A bounded live `/search` call is used only for a relevant cache miss or freshness/visual/current-state case, then successful results are cached. The existing acquisition ceiling remains authoritative: normally at most three Agent acquisition operations per turn.

Several Agents handling one human turn reuse the same bounded context path rather than triggering a full-corpus search per Agent. The shared evidence is still interpreted through each Agent's role, Soul, memory, and specialty.

Social and acknowledgement fast paths skip Knowledge retrieval. Casual conversation should not become slower or more formal because the catalog exists.

## Media and multimodal reasoning

Media metadata is first-class evidence. Visual queries first resolve a bounded
canonical product/page concept (for example, image generation or Workflow
Store), then rank page identity and route above incidental sidebar text. A
confidence gate rejects a wrong or ambiguous screenshot instead of delivering
it as evidence. Desktop is preferred unless the query explicitly requests
mobile. The resolved media identity is shared across Agents handling one human
turn, so each Agent receives the same visual evidence while retaining its own
specialist interpretation. Search can select a current screenshot by page,
route, title, tags, viewport, description, relation, and capture date. Media
binary is fetched only when a visual question or visual Agent work materially requires it:

1. authenticate to the Knowledge content endpoint;
2. validate the approved redirect and strip the Knowledge authorization header before any provider-host request;
3. bound the download to one supported image and a conservative byte limit;
4. validate magic bytes and deliver a data URL ephemerally to the existing Luna multimodal input path;
5. discard bytes after the turn.

Metadata-only retrieval does not permit an Agent to claim visual inspection. The runtime capability manifest says whether an image was actually delivered to that exact model turn. Media URLs are never projected to Telegram.

## GOD, autonomy, and gaps

GOD receives the same bounded ContextPack/provenance model as normal Agents. Its review can distinguish current Knowledge support, Agent memory, conversation evidence, stale records, and missing evidence without loading the full catalog.

Ambient and deep work use the same selective retrieval path. Knowledge changes become durable sync telemetry and can inform existing bounded opportunities; they do not automatically create Telegram messages. Repeatedly unanswered topics should be represented as bounded internal knowledge-gap telemetry, not fabricated facts.

## Administration and operations

Admin System exposes configured base URL, effective scope, cache counts, visibility/kind counts, sync state, cursor, last error, and bounded API usage metadata. `GET /api/admin/knowledge-v2` is authenticated. `POST /api/admin/knowledge-v2/sync` queues an incremental or full sync and requires the existing Admin CSRF/session protections.

Inspect last-good cache state before changing prompts or deleting data. A Knowledge outage is degraded evidence freshness, not permission to erase the cache or substitute generic model memory for current organizational facts.
