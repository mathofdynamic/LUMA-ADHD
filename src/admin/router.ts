import { DatabaseError } from "../database/errors";
import { jsonResponse, methodNotAllowed } from "../api/http";
import type { AgentJobMessage } from "../jobs";
import {
  AdminAuthError,
  AdminAuthService,
  withAdminSecurityHeaders,
} from "./auth";
import { adminServices, isThreadState } from "./service";
import { ADMIN_SETTING_DEFINITIONS } from "./settings";
import type { JsonObject } from "../database/validation";
import { createRepositories } from "../database/repositories";
import { createTelegramApplication, parseTelegramConfig, TelegramBotApiTransport } from "../telegram";
import type { TelegramRuntimeEnv } from "../telegram/webhook";

export interface AdminApiEnvironment extends Partial<Omit<TelegramRuntimeEnv, "DB">> {
  readonly DB?: D1Database;
  readonly AGENT_JOBS?: { send(message: AgentJobMessage): Promise<unknown> };
  readonly ADMIN_AUTH_SECRET?: string;
  readonly ADMIN_SESSION_TTL_SECONDS?: string;
  readonly LUMA_ENVIRONMENT?: string;
  readonly LUMA_PHASE?: string;
  readonly GOD_PROVIDER?: string;
  readonly GOD_API_KEY?: string;
  readonly GOD_MODEL?: string;
  readonly GOD_REASONING_EFFORT?: string;
  readonly NEBULA_MODEL?: string;
  readonly NEBULA_API_KEY?: string;
}

interface JsonBody {
  readonly [key: string]: unknown;
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const result = jsonResponse(body, status);
  const merged = new Headers(result.headers);
  if (headers) {
    new Headers(headers).forEach((value, key) => merged.set(key, value));
  }
  return withAdminSecurityHeaders(new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: merged,
  }));
}

function errorResponse(error: unknown): Response {
  if (error instanceof AdminAuthError) {
    const status = error.code === "not_configured" ? 503
      : error.code === "rate_limited" ? 429
        : error.code === "csrf_required" ? 403
          : 401;
    const headers = error.retryAfterSeconds === undefined
      ? undefined
      : { "retry-after": String(error.retryAfterSeconds) };
    return response({ error: error.code, message: error.message }, status, headers);
  }
  if (error instanceof DatabaseError) {
    const status = error.code === "not_found" ? 404 : error.code === "constraint" ? 409 : 400;
    return response({ error: error.code, message: error.message }, status);
  }
  console.warn(JSON.stringify({ event: "admin_api_failure", error: "bounded_admin_request_failure" }));
  return response({ error: "internal_error", message: "The admin operation could not be completed." }, 500);
}

async function readJson(request: Request): Promise<JsonBody> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 256_000) {
    throw new DatabaseError("validation", "request body is too large");
  }
  const text = await request.text();
  if (text.length > 256_000) throw new DatabaseError("validation", "request body is too large");
  if (text.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DatabaseError("validation", "request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DatabaseError("validation", "request body must be an object");
  }
  return parsed as JsonBody;
}

function stringField(body: JsonBody, key: string, fallback = ""): string {
  return typeof body[key] === "string" ? body[key] as string : fallback;
}

function optionalString(body: JsonBody, key: string): string | undefined {
  return typeof body[key] === "string" ? body[key] as string : undefined;
}

function stringList(body: JsonBody, key: string): readonly string[] | undefined {
  if (body[key] === undefined) return undefined;
  if (!Array.isArray(body[key])) throw new DatabaseError("validation", `${key} must be an array`);
  return body[key].filter((value): value is string => typeof value === "string").slice(0, 40);
}

function booleanField(body: JsonBody, key: string): boolean {
  return body[key] === true;
}

function query(request: Request, key: string): string | null {
  return new URL(request.url).searchParams.get(key);
}

function pathParts(request: Request): readonly string[] {
  const pathname = new URL(request.url).pathname;
  try {
    return pathname.slice("/api/admin".length).split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return [];
  }
}

function mutation(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}

function asObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as JsonObject;
}

async function queueJob(
  environment: AdminApiEnvironment,
  services: ReturnType<typeof adminServices>,
  job: JsonObject,
): Promise<void> {
  const jobId = typeof job.id === "string" ? job.id : "";
  if (!jobId) throw new DatabaseError("validation", "queued job has no id");
  const lastEnqueuedAt = job.lastEnqueuedAt;
  if (typeof lastEnqueuedAt === "string" && lastEnqueuedAt.length > 0) return;
  if (!environment.AGENT_JOBS) throw new DatabaseError("validation", "agent queue is not configured");
  await environment.AGENT_JOBS.send({
    kind: "agent.job",
    jobId,
    depth: typeof job.chainDepth === "number" ? job.chainDepth : 0,
    createdAt: new Date().toISOString(),
  });
  await services.repositories.jobs.markEnqueued(jobId).catch(() => undefined);
}

async function requireAuthenticated(
  request: Request,
  environment: AdminApiEnvironment,
): Promise<{ readonly auth: AdminAuthService; readonly session: Awaited<ReturnType<AdminAuthService["requireSession"]>>; readonly services: ReturnType<typeof adminServices> }> {
  if (!environment.DB) throw new AdminAuthError("not_configured", "admin database is not configured");
  const auth = new AdminAuthService(environment.DB, environment);
  const session = await auth.requireSession(request);
  let telegramApplication: ReturnType<typeof createTelegramApplication> | undefined;
  if (environment.TELEGRAM_GROUP_ID && environment.TELEGRAM_BOT_IDENTITIES_JSON) {
    try {
      const telegramConfig = parseTelegramConfig(environment);
      telegramApplication = createTelegramApplication({
        repositories: createRepositories(environment.DB),
        config: telegramConfig,
        transport: new TelegramBotApiTransport(telegramConfig),
      });
    } catch {
      telegramApplication = undefined;
    }
  }
  return {
    auth,
    session,
    services: adminServices(environment.DB, {
      godProvider: environment.GOD_PROVIDER,
      godModel: environment.GOD_MODEL,
      godReasoningEffort: environment.GOD_REASONING_EFFORT,
      godConfigured: Boolean(environment.GOD_PROVIDER && environment.GOD_MODEL && environment.GOD_API_KEY),
      nebulaModel: environment.NEBULA_MODEL,
      telegramConfigured: Boolean(environment.TELEGRAM_GATEWAY_BOT_TOKEN && environment.TELEGRAM_GROUP_ID),
      nebulaConfigured: Boolean(environment.NEBULA_API_KEY && environment.NEBULA_MODEL),
      adminConfigured: Boolean(environment.ADMIN_AUTH_SECRET),
      telegramGroupId: environment.TELEGRAM_GROUP_ID,
      telegramApplication,
    }),
  };
}

async function requireMutationSession(
  request: Request,
  environment: AdminApiEnvironment,
): Promise<Awaited<ReturnType<typeof requireAuthenticated>>> {
  const resolved = await requireAuthenticated(request, environment);
  await resolved.auth.requireCsrf(request, resolved.session);
  return resolved;
}

async function login(request: Request, environment: AdminApiEnvironment): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  if (!environment.DB) return errorResponse(new AdminAuthError("not_configured", "admin database is not configured"));
  const body = await readJson(request);
  const auth = new AdminAuthService(environment.DB, environment);
  const result = await auth.login(request, stringField(body, "accessKey"));
  const services = adminServices(environment.DB);
  const auditKey = `admin-login:${result.session.id}`;
  let audited = false;
  let auditError: unknown = undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await services.audit(result.session.id, "admin.login", "admin_session", result.session.id, { result: "success" }, auditKey);
      audited = true;
      break;
    } catch (error: unknown) {
      auditError = error;
    }
  }
  if (!audited) {
    await auth.revoke(result.session.id).catch(() => undefined);
    throw auditError ?? new Error("admin login audit could not be persisted");
  }
  return response({ authenticated: true, csrfToken: result.csrfToken, expiresAt: result.session.expiresAt }, 200, { "set-cookie": result.setCookie });
}

async function authRoute(request: Request, environment: AdminApiEnvironment, parts: readonly string[]): Promise<Response> {
  if (parts[1] === "login") return login(request, environment);
  const resolved = await requireAuthenticated(request, environment);
  if (parts[1] === "session" && request.method === "GET") {
    return response({ authenticated: true, expiresAt: resolved.session.expiresAt });
  }
  if (parts[1] === "bootstrap" && request.method === "GET") {
    const csrfToken = await resolved.auth.issueCsrfToken(resolved.session);
    return response({ authenticated: true, csrfToken, expiresAt: resolved.session.expiresAt });
  }
  if (parts[1] === "logout" && request.method === "POST") {
    await resolved.auth.requireCsrf(request, resolved.session);
    await resolved.services.audit(resolved.session.id, "admin.logout", "admin_session", resolved.session.id, { result: "success" });
    await resolved.auth.revoke(resolved.session.id);
    return response({ authenticated: false }, 200, { "set-cookie": resolved.auth.clearCookie(request) });
  }
  return response({ error: "not_found" }, 404);
}

async function handleAuthenticated(
  request: Request,
  environment: AdminApiEnvironment,
  parts: readonly string[],
): Promise<Response> {
  const resolved = mutation(request.method)
    ? await requireMutationSession(request, environment)
    : await requireAuthenticated(request, environment);
  const { services, session } = resolved;
  const resource = parts[0] ?? "";
  const id = parts[1];

  if (resource === "strategy-room" && request.method === "GET") return response(await services.strategyRoom());
  if (resource === "activity" && request.method === "GET") return response({ items: await services.activity(Number(query(request, "limit") ?? "30")) });

  if (resource === "agents" && request.method === "GET" && !id) return response({ items: await services.listAgents(true) });
  if (resource === "agents" && id && request.method === "GET" && parts.length === 2) return response(await services.agentDetail(id));
  if (resource === "agents" && id && request.method === "PATCH" && parts.length === 2) {
    const body = await readJson(request);
    const updated = await services.updateAgent({
      agentId: id,
      specialtyDescription: stringField(body, "specialtyDescription"),
      soul: stringField(body, "soul"),
      personality: stringField(body, "personality"),
      interests: stringList(body, "interests"),
    });
    await services.audit(session.id, "agent.configuration_updated", "agent", id, { fields: ["specialtyDescription", "soul", "personality", "interests"] });
    return response(updated);
  }
  if (resource === "agents" && id && (parts[2] === "pause" || parts[2] === "resume") && request.method === "POST") {
    const active = parts[2] === "resume";
    const updated = await services.setAgentActive(id, active);
    await services.audit(session.id, active ? "agent.resumed" : "agent.paused", "agent", id, { active });
    return response(updated);
  }

  if (resource === "threads" && request.method === "GET" && !id) {
    return response({ items: await services.listThreads({ limit: query(request, "limit"), state: query(request, "state"), search: query(request, "search"), participant: query(request, "participant"), important: query(request, "important") === "true" }) });
  }
  if (resource === "threads" && id && request.method === "GET" && parts.length === 2) return response(await services.threadDetail(id));
  if (resource === "threads" && id && parts[2] === "action" && request.method === "POST") {
    const body = await readJson(request);
    const action = stringField(body, "action");
    if (action === "continue") {
      const job = await services.enqueueJob({ jobType: "agent.ambient", payload: { source: "admin", threadId: id, wakeReason: "operator_continue" }, idempotencyKey: `admin-thread-continue:${id}:${Math.floor(Date.now() / 60_000)}`, priority: 80 });
      await queueJob(environment, services, job);
      await services.audit(session.id, "thread.continue_queued", "thread", id, { jobId: job.id });
      return response({ state: "queued", job });
    }
    const transitions: Readonly<Record<string, string>> = { park: "parked", reopen: "reopened", decide: "decided", reject: "rejected" };
    const target = transitions[action];
    if (!target || !isThreadState(target)) throw new DatabaseError("validation", "unsupported thread action");
    const current = await services.repositories.threads.getById(id);
    const updated = await services.repositories.threadLifecycle.transition({ threadId: id, to: target, reason: optionalString(body, "reason"), actor: { type: "system" } });
    await services.audit(session.id, `thread.${action}`, "thread", id, { from: current.state, to: updated.state });
    return response(updated);
  }

  if (resource === "files" && request.method === "GET" && !id) {
    return response({ items: await services.listFiles({ query: query(request, "search"), logicalPath: query(request, "path"), includeDeleted: query(request, "deleted") === "true", limit: query(request, "limit") }) });
  }
  if (resource === "files" && id && request.method === "GET" && parts.length === 2) return response(await services.fileDetail(id));
  if (resource === "files" && request.method === "POST" && !id) {
    const body = await readJson(request);
    const file = await services.createFile({ logicalPath: stringField(body, "logicalPath"), title: stringField(body, "title"), contentMarkdown: stringField(body, "contentMarkdown"), tags: stringList(body, "tags") });
    await services.audit(session.id, "document.created", "document", typeof file.document === "object" && file.document !== null && "id" in file.document ? String(file.document.id) : "unknown", { logicalPath: stringField(body, "logicalPath") });
    return response(file, 201);
  }
  if (resource === "files" && id && request.method === "PATCH" && parts.length === 2) {
    const body = await readJson(request);
    const file = await services.editFile(id, stringField(body, "contentMarkdown"), optionalString(body, "changeSummary"));
    await services.audit(session.id, "document.revised", "document", id, { changeSummary: optionalString(body, "changeSummary") ?? null });
    return response(file);
  }
  if (resource === "files" && id && request.method === "DELETE" && parts.length === 2) {
    await services.deleteFile(id);
    await services.audit(session.id, "document.deleted", "document", id, {});
    return response({ deleted: true });
  }
  if (resource === "files" && id && parts[2] === "restore" && request.method === "POST") {
    const file = await services.restoreFile(id);
    await services.audit(session.id, "document.restored", "document", id, {});
    return response(file);
  }
  if (resource === "files" && id && parts[2] === "versions" && parts[3] && request.method === "GET") {
    const version = await services.repositories.documents.getVersion(id, Number(parts[3]));
    return response(version);
  }

  if (resource === "knowledge" && request.method === "GET" && !id) return response({ items: await services.listKnowledge() });
  if (resource === "knowledge" && id && request.method === "GET" && parts.length === 2) return response(await services.knowledgeDetail(id));
  if (resource === "knowledge" && id && parts[2] === "refresh" && request.method === "POST") {
    const job = await services.createKnowledgeSyncJob(id);
    await queueJob(environment, services, job);
    await services.audit(session.id, "knowledge.refresh_queued", "knowledge_source", id, { jobId: job.id });
    return response({ state: "queued", job });
  }

  if (resource === "human-tasks" && request.method === "GET" && !id) return response({ items: await services.listHumanTasks({ status: query(request, "status"), limit: query(request, "limit") }) });
  if (resource === "human-tasks" && id === "phase07-smoke" && request.method === "POST") {
    const smoke = await services.createPhase07HumanTaskSmoke();
    await services.audit(session.id, "human_task.phase07_smoke_created", "human_task", typeof smoke.task === "object" && smoke.task !== null && "id" in smoke.task ? String(smoke.task.id) : "unknown", { reused: smoke.reused === true });
    return response(smoke, smoke.reused === true ? 200 : 201);
  }
  if (resource === "human-tasks" && id && request.method === "PATCH") {
    const body = await readJson(request);
    const task = await services.updateHumanTask(id, stringField(body, "status"), optionalString(body, "resolution"));
    if (typeof task.wakeJob === "object" && task.wakeJob !== null) await queueJob(environment, services, asObject(task.wakeJob));
    await services.audit(session.id, "human_task.status_updated", "human_task", id, { status: stringField(body, "status") });
    return response(task);
  }

  if (resource === "artifacts" && request.method === "GET" && !id) {
    return response({ items: await services.listArtifacts({ limit: query(request, "limit"), includeDeleted: query(request, "deleted") === "true" }) });
  }
  if (resource === "artifacts" && id === "phase07-smoke" && request.method === "POST") {
    const smoke = await services.createPhase07DiagramSmoke();
    await services.audit(session.id, "artifact.phase07_smoke_created", "artifact", typeof smoke.artifact === "object" && smoke.artifact !== null && "id" in smoke.artifact ? String(smoke.artifact.id) : "unknown", { reused: smoke.reused === true });
    return response(smoke, smoke.reused === true ? 200 : 201);
  }
  if (resource === "artifacts" && id && request.method === "GET" && parts.length === 2) return response(await services.artifactDetail(id));
  if (resource === "artifacts" && id && parts[2] === "render" && request.method === "POST") {
    const artifact = await services.renderArtifact(id);
    await services.audit(session.id, "artifact.render_requested", "artifact", id, { status: artifact.renderStatus });
    return response(artifact);
  }
  if (resource === "artifacts" && id && parts[2] === "archive" && request.method === "POST") {
    const artifact = await services.diagrams.archive(id);
    await services.audit(session.id, "artifact.archived", "artifact", id, {});
    return response(artifact);
  }
  if (resource === "artifacts" && id && parts[2] === "restore" && request.method === "POST") {
    const artifact = await services.diagrams.restore(id);
    await services.audit(session.id, "artifact.restored", "artifact", id, {});
    return response(artifact);
  }

  if (resource === "reputation" && request.method === "GET" && !id) return response({ items: await services.reputationOverview(query(request, "domain")) });
  if (resource === "reputation" && id && request.method === "GET") return response(await services.reputationDetail(id));

  if (resource === "god" && request.method === "GET" && !id) return response(await services.godOverview());
  if (resource === "god" && id === "reviews" && parts[2] && request.method === "GET") return response(await services.godDetail(parts[2]));
  if (resource === "god" && id === "directives" && parts[2] && request.method === "PATCH") {
    const body = await readJson(request);
    const directive = await services.updateDirective(parts[2], stringField(body, "status"), optionalString(body, "resolution"));
    await services.audit(session.id, "god_directive.status_updated", "god_directive", parts[2], { status: stringField(body, "status") });
    return response(directive);
  }
  if (resource === "god" && id === "review" && request.method === "POST") {
    const job = await services.enqueueJob({ jobType: "god.review", payload: { source: "operator", publishTelegram: false }, idempotencyKey: `admin-god-review:${Math.floor(Date.now() / (12 * 60 * 60 * 1000))}`, priority: 40 });
    await queueJob(environment, services, job);
    await services.audit(session.id, "god.review_queued", "god_review", String(job.id), { jobId: job.id });
    return response({ state: "queued", job });
  }

  if (resource === "system" && id && (parts[2] === "retry" || parts[2] === "recover") && request.method === "POST") {
    const job = parts[2] === "retry" ? await services.retryJob(id) : await services.recoverStaleJob(id);
    await services.audit(session.id, parts[2] === "retry" ? "job.retry_requested" : "job.stale_recovered", "job", id, { status: job.status });
    if (parts[2] === "retry") await queueJob(environment, services, job);
    return response({ state: parts[2] === "retry" ? "queued" : "recovered", job });
  }

  if (resource === "system" && request.method === "GET") return response(await services.listSystem());
  if (resource === "audit" && request.method === "GET") return response({ items: await services.listAudit(Number(query(request, "limit") ?? "80")) });
  if (resource === "settings" && request.method === "GET") return response(await services.settings());
  if (resource === "settings" && id && request.method === "PATCH") {
    const body = await readJson(request);
    if (!Object.prototype.hasOwnProperty.call(ADMIN_SETTING_DEFINITIONS, id)) throw new DatabaseError("validation", "unknown admin setting");
    const setting = await services.updateSetting(id, body.value, session.id);
    await services.audit(session.id, "setting.updated", "admin_setting", id, { value: setting.value });
    return response(setting);
  }
  if (resource === "settings" && id && parts[2] === "reset" && request.method === "POST") {
    const setting = await services.resetSetting(id, session.id);
    await services.audit(session.id, "setting.reset", "admin_setting", id, { value: setting.value });
    return response(setting);
  }

  return response({ error: "not_found" }, 404);
}

export async function handleAdminApi(request: Request, environment: AdminApiEnvironment): Promise<Response> {
  const parts = pathParts(request);
  try {
    if (parts[0] === "auth") return await authRoute(request, environment, parts);
    return await handleAuthenticated(request, environment, parts);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
