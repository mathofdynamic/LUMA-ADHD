import type { DatabaseClient } from "../database/client";
import { createId, nowIso } from "../database/ids";
import { ValidationError } from "../database/errors";
import { encodeObject, type JsonObject, type JsonValue } from "../database/validation";
import { createRepositories } from "../database/repositories";
import { DocumentService } from "../memory/document-service";
import { InstitutionalMemorySearch } from "../memory/retrieval";
import { officialSourceByKey } from "../knowledge/sources";
import { HumanTaskService } from "../human-tasks";
import { DiagramService } from "../diagrams";
import { listAdminSettings, resetAdminSetting, setAdminSetting, type AdminSettingKey } from "./settings";
import type { HumanTaskStatus, ThreadState } from "../database/types";

type Repositories = ReturnType<typeof createRepositories>;
type Row = Record<string, unknown>;

export interface AdminRuntimeDisplayConfig {
  readonly normalProvider?: string;
  readonly normalModel?: string;
  readonly normalReasoningEffort?: string;
  readonly normalConfigured?: boolean;
  readonly openaiConfigured?: boolean;
  readonly godProvider?: string;
  readonly godModel?: string;
  readonly godReasoningEffort?: string;
  readonly godConfigured?: boolean;
  readonly nebulaModel?: string;
  readonly telegramConfigured?: boolean;
  readonly nebulaConfigured?: boolean;
  readonly adminConfigured?: boolean;
  readonly telegramGroupId?: string;
  readonly telegramApplication?: Pick<import("../telegram").TelegramApplicationService, "projectAgentMessage">;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function objectValue(value: unknown): JsonObject {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

function jsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function jsonObject(value: unknown): JsonObject {
  return value as JsonObject;
}

function stringArrayValue(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 24)
    : [];
}

function nullableNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function estimatedOpenAICostUsd(model: unknown, inputTokens: unknown, outputTokens: unknown): number | null {
  if (model !== "gpt-5.6-luna") return null;
  const input = numberValue(inputTokens, 0);
  const output = numberValue(outputTokens, 0);
  return Number(((input * 0.2 + output * 1.2) / 1_000_000).toFixed(8));
}

function nullableJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
}

function jsonRows(rows: readonly Row[]): readonly JsonObject[] {
  return rows.map((row) => jsonObject(row));
}

function arrayValue(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function limitValue(value: string | null, fallback = 50, maximum = 100): number {
  const parsed = value === null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function safeSearch(value: string | null): string | null {
  const normalized = value?.trim().slice(0, 160) ?? "";
  return normalized.length > 0 ? normalized : null;
}

function parsePayload(value: unknown): JsonObject {
  return objectValue(value);
}

function agentCard(row: Row): JsonObject {
  const active = booleanValue(row.is_active);
  const running = numberValue(row.running_turns) > 0;
  const lastActivity = nullableString(row.last_meaningful_activity_at) ?? nullableString(row.last_activity_at);
  const lastOpportunity = nullableString(row.last_opportunity_at);
  const activityAge = lastActivity ? Date.now() - Date.parse(lastActivity) : Number.POSITIVE_INFINITY;
  const opportunityAge = lastOpportunity ? Date.now() - Date.parse(lastOpportunity) : Number.POSITIVE_INFINITY;
  const status = !active
    ? "paused"
    : running
      ? "active"
      : activityAge <= 24 * 60 * 60 * 1000
        ? "recent"
        : opportunityAge <= 24 * 60 * 60 * 1000
          ? "opportunity"
          : "quiet";
  return {
    id: stringValue(row.id),
    slug: stringValue(row.slug),
    displayName: stringValue(row.display_name),
    specialty: stringValue(row.specialty),
    specialtyDescription: stringValue(row.specialty_description),
    rank: numberValue(row.rank, 10),
    isSupervisor: booleanValue(row.is_supervisor),
    isActive: active,
    status,
    currentThreadId: nullableString(row.current_thread_id),
    currentThreadTitle: nullableString(row.current_thread_title),
    lastActivityAt: lastActivity,
    lastTurnStatus: nullableString(row.last_turn_status),
    lastTurnAt: nullableString(row.last_turn_at),
    recentMessageAt: nullableString(row.recent_message_at),
    lastOpportunityAt: lastOpportunity,
    lastMeaningfulActivityAt: nullableString(row.last_meaningful_activity_at),
    activity: {
      opportunities24h: numberValue(row.opportunities_24h),
      opportunities7d: numberValue(row.opportunities_7d),
      speak24h: numberValue(row.speak_24h),
      speak7d: numberValue(row.speak_7d),
      wait24h: numberValue(row.wait_24h),
      wait7d: numberValue(row.wait_7d),
      failed24h: numberValue(row.failed_24h),
      failed7d: numberValue(row.failed_7d),
      fileWork24h: numberValue(row.file_work_24h),
      fileWork7d: numberValue(row.file_work_7d),
      durableWork24h: numberValue(row.durable_work_24h),
      durableWork7d: numberValue(row.durable_work_7d),
    },
  };
}

export class AdminObservatoryService {
  readonly documents: DocumentService;
  readonly search: InstitutionalMemorySearch;
  readonly humanTasks: HumanTaskService;
  readonly diagrams: DiagramService;

  constructor(
    readonly database: DatabaseClient,
    readonly repositories: Repositories,
    readonly runtimeConfig: AdminRuntimeDisplayConfig = {},
  ) {
    this.documents = new DocumentService(repositories);
    this.search = new InstitutionalMemorySearch(database);
    this.humanTasks = new HumanTaskService({ repositories, telegram: runtimeConfig.telegramApplication });
    this.diagrams = new DiagramService(repositories);
  }

  async audit(
    sessionId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: JsonObject = {},
    idempotencyKey?: string,
  ): Promise<void> {
    const timestamp = nowIso();
    await this.database.prepare(
      `INSERT INTO audit_log (
        id, action, entity_type, entity_id, actor_type, payload_json,
        idempotency_key, admin_session_id, created_at
      ) VALUES (?, ?, ?, ?, 'system', ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING`,
    ).bind(
      createId("admin-audit"),
      action,
      entityType,
      entityId,
      encodeObject(payload, "admin audit payload"),
      idempotencyKey ?? `admin:${sessionId}:${action}:${entityType}:${entityId}:${timestamp}`,
      sessionId,
      timestamp,
    ).run();
  }

  async strategyRoom(): Promise<JsonObject> {
    const [agents, threads, tasks, failedJobs, directives, god, activity, pressure] = await Promise.all([
      this.listAgents(false),
      this.listThreads({ limit: "8", important: true }),
      this.listHumanTasks({ status: "open", limit: "8" }),
      this.database.prepare(
        `SELECT id, job_type, status, last_error, attempt_count, created_at, updated_at
         FROM jobs WHERE status IN ('failed', 'retry_scheduled')
         ORDER BY updated_at DESC LIMIT 8`,
      ).all<Row>(),
      this.database.prepare(
        `SELECT gd.id, gd.directive, gd.priority, gd.status, gd.created_at,
                a.display_name AS agent_name, t.title AS thread_title
         FROM god_directives gd
         LEFT JOIN agents a ON a.id = gd.target_agent_id
         LEFT JOIN threads t ON t.id = gd.target_thread_id
         WHERE gd.status IN ('open', 'acknowledged')
         ORDER BY gd.priority DESC, gd.created_at ASC LIMIT 8`,
      ).all<Row>(),
      this.latestGodReview(),
      this.listActivity(12),
      this.pressureSummary(),
    ]);

    const attention: JsonObject[] = [];
    for (const task of tasks) attention.push({ kind: "human_task", severity: numberValue(task.priority) >= 80 ? "high" : "normal", ...task });
    for (const thread of threads.filter((item) => item.state === "human_required" || item.state === "blocked")) {
      const priority = numberValue(thread.priority);
      const state = stringValue(thread.state);
      attention.push({ kind: "thread", severity: itemPriority(priority), title: stringValue(thread.title), why: state === "blocked" ? "Thread is blocked" : "Human input is required", threadId: stringValue(thread.id), state, age: nullableString(thread.lastActivityAt) });
    }
    for (const row of failedJobs.results) attention.push({ kind: "job", severity: "high", title: stringValue(row.job_type), why: stringValue(row.last_error, "Job failed"), jobId: stringValue(row.id), age: stringValue(row.updated_at), status: stringValue(row.status) });
    for (const row of directives.results) attention.push({ kind: "god_directive", severity: numberValue(row.priority) >= 80 ? "high" : "normal", title: stringValue(row.directive), why: "Open GOD directive", directiveId: stringValue(row.id), agent: nullableString(row.agent_name), thread: nullableString(row.thread_title), age: stringValue(row.created_at) });

    const normalAgents = agents.filter((agent) => !booleanValue(agent.isSupervisor));
    return {
      generatedAt: nowIso(),
      status: {
        operatingState: numberValue(pressure.failedJobs) > 0 ? "attention" : numberValue(pressure.activeTurns) > 0 ? "operating" : "quiet",
        activeAgents: normalAgents.filter((agent) => agent.status === "active").length,
        normalAgents: normalAgents.length,
        activeImportantThreads: threads.length,
        humanRequired: tasks.length,
        failedJobs: pressure.failedJobs,
        openGodDirectives: directives.results.length,
        lastGodReview: god,
      },
      attention: attention.slice(0, 20),
      agents: normalAgents,
      threads,
      activity,
      god,
      pressure,
    };
  }

  async listAgents(includeGod = true): Promise<readonly JsonObject[]> {
    const result = await this.database.prepare(
      `WITH turn_activity AS (
        SELECT at.agent_id,
          SUM(CASE WHEN at.created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS opportunities_24h,
          SUM(CASE WHEN at.created_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS opportunities_7d,
          SUM(CASE WHEN at.created_at >= datetime('now','-1 day') AND json_extract(at.metadata_json, '$.intent') = 'SPEAK' THEN 1 ELSE 0 END) AS speak_24h,
          SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND json_extract(at.metadata_json, '$.intent') = 'SPEAK' THEN 1 ELSE 0 END) AS speak_7d,
          SUM(CASE WHEN at.created_at >= datetime('now','-1 day') AND json_extract(at.metadata_json, '$.intent') = 'WAIT' THEN 1 ELSE 0 END) AS wait_24h,
          SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND json_extract(at.metadata_json, '$.intent') = 'WAIT' THEN 1 ELSE 0 END) AS wait_7d,
          SUM(CASE WHEN at.created_at >= datetime('now','-1 day') AND at.status = 'failed' THEN 1 ELSE 0 END) AS failed_24h,
          SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND at.status = 'failed' THEN 1 ELSE 0 END) AS failed_7d,
          SUM(CASE WHEN at.created_at >= datetime('now','-1 day') AND json_extract(at.metadata_json, '$.intent') = 'FILE_WORK' THEN 1 ELSE 0 END) AS file_work_24h,
          SUM(CASE WHEN at.created_at >= datetime('now','-7 day') AND json_extract(at.metadata_json, '$.intent') = 'FILE_WORK' THEN 1 ELSE 0 END) AS file_work_7d,
          MAX(at.created_at) AS last_opportunity_at,
          MAX(CASE WHEN at.status = 'completed' AND COALESCE(json_extract(at.metadata_json, '$.intent'), '') <> 'WAIT' THEN at.created_at END) AS last_turn_meaningful_at
        FROM agent_turns at
        WHERE at.created_at >= datetime('now','-7 day')
        GROUP BY at.agent_id
      ), durable_activity AS (
        SELECT e.actor_agent_id AS agent_id,
          SUM(CASE WHEN e.occurred_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS durable_work_24h,
          SUM(CASE WHEN e.occurred_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS durable_work_7d,
          MAX(e.occurred_at) AS last_durable_work_at
        FROM events e
        WHERE e.actor_agent_id IS NOT NULL
          AND e.occurred_at >= datetime('now','-7 day')
          AND e.event_type IN ('runtime.file_work_completed', 'runtime.memory_note_created', 'runtime.decision_recorded')
        GROUP BY e.actor_agent_id
      )
      SELECT a.*,
        (SELECT COUNT(*) FROM agent_turns at WHERE at.agent_id = a.id AND at.status = 'running') AS running_turns,
        (SELECT MAX(at.created_at) FROM agent_turns at WHERE at.agent_id = a.id) AS last_turn_at,
        (SELECT at.status FROM agent_turns at WHERE at.agent_id = a.id ORDER BY at.created_at DESC LIMIT 1) AS last_turn_status,
        (SELECT MAX(m.created_at) FROM messages m WHERE m.author_agent_id = a.id AND m.deleted_at IS NULL) AS recent_message_at,
        MAX(
          (SELECT MAX(m.created_at) FROM messages m WHERE m.author_agent_id = a.id AND m.deleted_at IS NULL),
          ta.last_turn_meaningful_at,
          da.last_durable_work_at
        ) AS last_meaningful_activity_at,
        ta.opportunities_24h, ta.opportunities_7d, ta.speak_24h, ta.speak_7d,
        ta.wait_24h, ta.wait_7d, ta.failed_24h, ta.failed_7d,
        ta.file_work_24h, ta.file_work_7d,
        (SELECT MAX(at.created_at) FROM agent_turns at WHERE at.agent_id = a.id) AS last_opportunity_at,
        da.durable_work_24h, da.durable_work_7d,
        (SELECT t.id FROM agent_turns at JOIN threads t ON t.id = at.thread_id
         WHERE at.agent_id = a.id AND at.status = 'running' ORDER BY at.created_at DESC LIMIT 1) AS current_thread_id,
        (SELECT t.title FROM agent_turns at JOIN threads t ON t.id = at.thread_id
         WHERE at.agent_id = a.id AND at.status = 'running' ORDER BY at.created_at DESC LIMIT 1) AS current_thread_title
       FROM agents a
       LEFT JOIN turn_activity ta ON ta.agent_id = a.id
       LEFT JOIN durable_activity da ON da.agent_id = a.id
       WHERE a.deleted_at IS NULL AND (? = 1 OR a.is_supervisor = 0)
       ORDER BY a.is_supervisor ASC, a.display_name ASC
       LIMIT 20`,
    ).bind(includeGod ? 1 : 0).all<Row>();
    return result.results.map(agentCard);
  }

  async agentDetail(agentId: string): Promise<JsonObject> {
    const agent = await this.repositories.agents.getById(agentId);
    const [specialties, interests, turns, messages, files, states, snapshots, evidence, usage, config, roster] = await Promise.all([
      this.repositories.agents.listSpecialties(agentId),
      this.repositories.agents.listInterests(agentId),
      this.database.prepare(
        `SELECT at.id, at.thread_id, at.sequence_number, at.status, at.wake_reason,
                at.output_message_id, at.metadata_json, at.created_at, at.started_at, at.finished_at, t.title AS thread_title
         FROM agent_turns at LEFT JOIN threads t ON t.id = at.thread_id
         WHERE at.agent_id = ? ORDER BY at.created_at DESC LIMIT 20`,
      ).bind(agentId).all<Row>(),
      this.database.prepare(
        `SELECT m.id, m.thread_id, m.content_text, m.visibility, m.created_at,
                t.title AS thread_title
         FROM messages m LEFT JOIN threads t ON t.id = m.thread_id
         WHERE m.author_agent_id = ? AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT 20`,
      ).bind(agentId).all<Row>(),
      this.repositories.documents.listAccessible({ agentId, system: true, limit: 40 }),
      this.repositories.reputation.listDomainStates(agentId),
      this.database.prepare(
        `SELECT * FROM reputation_snapshots WHERE agent_id = ?
         ORDER BY captured_at DESC LIMIT 40`,
      ).bind(agentId).all<Row>(),
      this.database.prepare(
        `SELECT * FROM reputation_events WHERE agent_id = ?
         ORDER BY created_at DESC LIMIT 40`,
      ).bind(agentId).all<Row>(),
      this.database.prepare(
        `SELECT provider_name, model_name, status, total_tokens, duration_ms, error_summary, created_at
         FROM provider_usage WHERE agent_turn_id IN (SELECT id FROM agent_turns WHERE agent_id = ?)
         ORDER BY created_at DESC LIMIT 20`,
      ).bind(agentId).all<Row>(),
      this.database.prepare(
        `SELECT id, version, provider_role, model_key, prompt_version, config_json, is_active, created_at
         FROM agent_configurations WHERE agent_id = ? ORDER BY version DESC LIMIT 10`,
      ).bind(agentId).all<Row>(),
      this.listAgents(true),
    ]);
    const existingAgentSummary = roster.find((item) => stringValue(item.id) === agentId);
    return {
      ...(existingAgentSummary ?? agentCard({
        id: agent.id,
        slug: agent.slug,
        display_name: agent.displayName,
        specialty: agent.specialty,
        specialty_description: agent.specialtyDescription,
        rank: agent.rank,
        is_supervisor: agent.isSupervisor ? 1 : 0,
        is_active: agent.isActive ? 1 : 0,
        last_activity_at: messages.results[0]?.created_at,
        running_turns: turns.results.filter((row) => row.status === "running").length,
        last_turn_at: turns.results[0]?.created_at,
        last_turn_status: turns.results[0]?.status,
      })),
      soul: agent.soul,
      personality: agent.personality,
      config: agent.config,
      metadata: agent.metadata,
      specialties: jsonValue(specialties),
      interests: jsonValue(interests),
      turns: jsonRows(turns.results.map((row) => {
        const metadata = objectValue(row.metadata_json);
        const selection = typeof metadata.selection === "object" && metadata.selection !== null && !Array.isArray(metadata.selection)
          ? metadata.selection as JsonObject
          : {};
        return {
          ...row,
          selection,
          selectionDiagnostics: {
            selectedAgentId: nullableString(selection.selectedAgentId),
            perspectiveDomain: nullableString(selection.perspectiveDomain),
            reasons: stringArrayValue(selection.reasons),
            conversationFocus: nullableJsonObject(selection.conversationFocus),
            coveredDomains: stringArrayValue(selection.coveredDomains),
             coverageBonus: nullableNumber(selection.coverageBonus),
             coveragePenalty: nullableNumber(selection.coveragePenalty),
             explorationUsed: nullableBoolean(selection.explorationUsed),
             promptVersion: nullableString(metadata.promptVersion),
             interactionMode: nullableString(metadata.mode),
             interactionIntent: nullableString(nullableJsonObject(selection.conversationFocus)?.interactionIntent),
             boundaryReason: nullableString(nullableJsonObject(selection.conversationFocus)?.boundaryReason),
             retrievalSkippedReason: nullableString(nullableJsonObject(selection.conversationFocus)?.retrievalSkippedReason),
             superseded: nullableBoolean(metadata.superseded),
             capabilities: nullableJsonObject(metadata.capabilities),
           },
        };
      })),
      messages: jsonRows(messages.results),
      files: jsonValue(files),
      reputation: { states: jsonValue(states), snapshots: jsonRows(snapshots.results), evidence: jsonRows(evidence.results) },
      providerUsage: jsonRows(usage.results),
      configurationHistory: jsonRows(config.results.map((row) => ({ ...row, config: objectValue(row.config_json) }))),
    };
  }

  async updateAgent(input: {
    readonly agentId: string;
    readonly specialtyDescription: string;
    readonly soul: string;
    readonly personality: string;
    readonly interests?: readonly string[];
  }): Promise<JsonObject> {
    const updated = await this.repositories.agents.updateProfile(input);
    return this.agentDetail(updated.id);
  }

  async setAgentActive(agentId: string, active: boolean): Promise<JsonObject> {
    const agent = await this.repositories.agents.getById(agentId);
    if (agent.isSupervisor) throw new ValidationError("GOD is not paused through the normal Agent control");
    return agentCard({
      id: (await this.repositories.agents.setActive(agentId, active)).id,
      slug: agent.slug,
      display_name: agent.displayName,
      specialty: agent.specialty,
      specialty_description: agent.specialtyDescription,
      rank: agent.rank,
      is_supervisor: 0,
      is_active: active ? 1 : 0,
      running_turns: 0,
    });
  }

  async listThreads(input: {
    readonly limit?: string | null;
    readonly state?: string | null;
    readonly search?: string | null;
    readonly participant?: string | null;
    readonly important?: boolean;
  } = {}): Promise<readonly JsonObject[]> {
    const limit = limitValue(input.limit ?? null, 50, 100);
    const state = input.state && ["open", "exploring", "debating", "evidence_gathering", "developing", "synthesizing", "human_required", "blocked", "decided", "rejected", "parked", "reopened"].includes(input.state) ? input.state : null;
    const search = safeSearch(input.search ?? null);
    const participant = safeSearch(input.participant ?? null);
    const result = await this.database.prepare(
      `SELECT t.id, t.title, t.state, t.priority, t.summary, t.turns_used, t.turn_budget,
              t.phase_turns_used, t.phase_budget, t.last_activity_at, t.created_at,
              (SELECT COUNT(*) FROM thread_participants tp WHERE tp.thread_id = t.id AND tp.left_at IS NULL) AS participant_count,
              (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.deleted_at IS NULL) AS message_count,
              (SELECT group_concat(COALESCE(a.display_name, u.display_name), ' · ')
               FROM thread_participants tp
               LEFT JOIN agents a ON a.id = tp.agent_id
               LEFT JOIN users u ON u.id = tp.user_id
               WHERE tp.thread_id = t.id AND tp.left_at IS NULL) AS participants,
              (SELECT COUNT(*) FROM human_tasks ht WHERE ht.thread_id = t.id AND ht.deleted_at IS NULL AND ht.status IN ('open','claimed','in_progress','blocked')) AS task_count,
              (SELECT COUNT(*) FROM god_directives gd WHERE gd.target_thread_id = t.id AND gd.status IN ('open','acknowledged')) AS directive_count
       FROM threads t
       WHERE t.deleted_at IS NULL
         AND (? IS NULL OR t.state = ?)
         AND (? IS NULL OR t.title LIKE ? OR COALESCE(t.summary, '') LIKE ?)
         AND (? IS NULL OR EXISTS (SELECT 1 FROM thread_participants tp2 WHERE tp2.thread_id = t.id AND tp2.agent_id = ?))
         AND (? = 0 OR t.state IN ('human_required','blocked','debating','developing','synthesizing') OR t.priority >= 70)
       ORDER BY t.priority DESC, t.last_activity_at DESC
       LIMIT ?`,
    ).bind(
      state, state,
      search, search ? `%${search}%` : null, search ? `%${search}%` : null,
      participant, participant,
      input.important === true ? 1 : 0,
      limit,
    ).all<Row>();
    return result.results.map((row) => ({
      id: stringValue(row.id), title: stringValue(row.title), state: stringValue(row.state),
      priority: numberValue(row.priority), summary: nullableString(row.summary),
      turnsUsed: numberValue(row.turns_used), turnBudget: numberValue(row.turn_budget),
      phaseTurnsUsed: numberValue(row.phase_turns_used), phaseBudget: numberValue(row.phase_budget),
      lastActivityAt: stringValue(row.last_activity_at), createdAt: stringValue(row.created_at),
      participants: stringValue(row.participants).split(" · ").filter(Boolean),
      participantCount: numberValue(row.participant_count), messageCount: numberValue(row.message_count),
      taskCount: numberValue(row.task_count), directiveCount: numberValue(row.directive_count),
    }));
  }

  async threadDetail(threadId: string): Promise<JsonObject> {
    const thread = await this.repositories.threads.getById(threadId);
    const [messages, participants, turns, decisions, tasks, directives, files, summary, events] = await Promise.all([
      this.database.prepare(
        `SELECT m.id, m.content_text, m.author_type, m.author_agent_id, m.author_user_id,
                m.reply_to_message_id, m.visibility, m.origin, m.telegram_bot_alias, m.metadata_json, m.created_at,
                COALESCE(a.display_name, u.display_name, 'System') AS author_name
         FROM messages m
         LEFT JOIN agents a ON a.id = m.author_agent_id
         LEFT JOIN users u ON u.id = m.author_user_id
         WHERE m.thread_id = ? AND m.deleted_at IS NULL
         ORDER BY m.created_at ASC, m.id ASC LIMIT 200`,
      ).bind(threadId).all<Row>(),
      this.database.prepare(
        `SELECT tp.agent_id, tp.user_id, tp.role, COALESCE(a.display_name, u.display_name) AS display_name
         FROM thread_participants tp LEFT JOIN agents a ON a.id = tp.agent_id LEFT JOIN users u ON u.id = tp.user_id
         WHERE tp.thread_id = ? AND tp.left_at IS NULL ORDER BY display_name ASC`,
      ).bind(threadId).all<Row>(),
      this.database.prepare(
        `SELECT at.id, at.agent_id, a.display_name, at.sequence_number, at.status,
                at.wake_reason, at.metadata_json, at.created_at, at.started_at, at.finished_at
         FROM agent_turns at LEFT JOIN agents a ON a.id = at.agent_id
         WHERE at.thread_id = ? ORDER BY at.sequence_number ASC LIMIT 100`,
      ).bind(threadId).all<Row>(),
      this.database.prepare("SELECT * FROM decision_records WHERE thread_id = ? ORDER BY created_at DESC LIMIT 30").bind(threadId).all<Row>(),
      this.listHumanTasks({ threadId, limit: "20" }),
      this.database.prepare(
        `SELECT gd.*, a.display_name AS agent_name FROM god_directives gd
         LEFT JOIN agents a ON a.id = gd.target_agent_id
         WHERE gd.target_thread_id = ? ORDER BY gd.created_at DESC LIMIT 30`,
      ).bind(threadId).all<Row>(),
      this.repositories.documents.listAccessible({ threadId, system: true, limit: 30 }),
      this.database.prepare("SELECT * FROM thread_summaries WHERE thread_id = ? ORDER BY updated_at DESC LIMIT 5").bind(threadId).all<Row>(),
      this.database.prepare("SELECT * FROM events WHERE thread_id = ? ORDER BY occurred_at DESC LIMIT 60").bind(threadId).all<Row>(),
    ]);
    return {
      ...thread,
      participants: jsonRows(participants.results),
      messages: jsonRows(messages.results.map((row) => {
        const metadata = objectValue(row.metadata_json);
        return {
          ...row,
          metadata,
          attachment: nullableJsonObject(metadata.attachment),
        };
      })),
      turns: jsonRows(turns.results.map((row) => ({ ...row, metadata: objectValue(row.metadata_json) }))),
      decisions: jsonRows(decisions.results.map((row) => ({ ...row, evidence: arrayValue(row.evidence_json) }))),
      humanTasks: tasks,
      godDirectives: jsonRows(directives.results),
      files: jsonValue(files),
      summaries: jsonRows(summary.results.map((row) => ({ ...row, metadata: objectValue(row.metadata_json) }))),
      events: jsonRows(events.results.map((row) => ({ ...row, payload: objectValue(row.payload_json) }))),
    };
  }

  async listHumanTasks(input: { readonly status?: string | null; readonly threadId?: string; readonly limit?: string | null } = {}): Promise<readonly JsonObject[]> {
    const status = input.status && ["open", "claimed", "in_progress", "blocked", "completed", "rejected", "cancelled"].includes(input.status) ? input.status : null;
    const limit = limitValue(input.limit ?? null, 50, 100);
    const result = await this.database.prepare(
      `SELECT ht.*, t.title AS thread_title, a.display_name AS requester_name
       FROM human_tasks ht LEFT JOIN threads t ON t.id = ht.thread_id LEFT JOIN agents a ON a.id = ht.requested_by_agent_id
       WHERE ht.deleted_at IS NULL AND (? IS NULL OR ht.status = ?) AND (? IS NULL OR ht.thread_id = ?)
       ORDER BY ht.priority DESC, ht.created_at ASC LIMIT ?`,
    ).bind(status, status, input.threadId ?? null, input.threadId ?? null, limit).all<Row>();
    return result.results.map((row) => {
      const taskStatus = stringValue(row.status);
      const blocking = booleanValue(row.blocking);
      const blockingOpen = blocking && !["completed", "rejected", "cancelled"].includes(taskStatus);
      return {
        id: stringValue(row.id), title: stringValue(row.title), description: stringValue(row.description),
        status: taskStatus, priority: numberValue(row.priority), dueAt: nullableString(row.due_at),
        resolution: nullableString(row.resolution), threadId: nullableString(row.thread_id), threadTitle: nullableString(row.thread_title),
        requesterName: nullableString(row.requester_name), reason: stringValue(row.reason), blocking: blockingOpen, blockingRequested: blocking, blockingOpen,
        blockingStatus: blocking ? (blockingOpen ? "blocking" : "resolved") : "non_blocking",
        targetHumanUserId: nullableString(row.target_human_user_id), requestMessageId: nullableString(row.request_message_id),
        responseMessageId: nullableString(row.response_message_id), respondedByUserId: nullableString(row.responded_by_user_id),
        responseSource: stringValue(row.response_source, "none"), resolvedAt: nullableString(row.resolved_at),
        projectionStatus: stringValue(row.projection_status, "not_requested"), projectionError: nullableString(row.projection_error),
        telegramMessageId: nullableString(row.telegram_message_id), telegramBotAlias: nullableString(row.telegram_bot_alias),
        wakeJobId: nullableString(row.wake_job_id), createdAt: stringValue(row.created_at), updatedAt: stringValue(row.updated_at),
      };
    });
  }

  async listArtifacts(input: { readonly limit?: string | null; readonly includeDeleted?: boolean } = {}): Promise<readonly JsonObject[]> {
    const artifacts = await this.diagrams.list({ limit: limitValue(input.limit ?? null, 50, 100), includeDeleted: input.includeDeleted === true });
    return artifacts.map((artifact) => {
      const { sourceText: _sourceText, ...summary } = artifact;
      return jsonObject(summary);
    });
  }

  async artifactDetail(id: string): Promise<JsonObject> {
    const detail = await this.diagrams.detail(id);
    return { artifact: jsonObject(detail.artifact), revisions: jsonValue(detail.revisions.map((revision) => jsonObject(revision))) };
  }

  async renderArtifact(id: string): Promise<JsonObject> {
    return jsonObject(await this.diagrams.render(id));
  }

  async createPhase07DiagramSmoke(): Promise<JsonObject> {
    const idempotencyKey = "phase07-live-diagram-smoke";
    const existing = await this.repositories.artifacts.findByIdempotencyKey(idempotencyKey);
    if (existing) return { reused: true, artifact: jsonObject(existing) };

    const created = await this.diagrams.create({
      actor: { agentId: "agent-technical" },
      idempotencyKey,
      metadata: { phase07Smoke: true, purpose: "controlled operator validation" },
      spec: {
        diagramType: "architecture",
        title: "LUMA ADHD — Phase 07 architecture smoke",
        direction: "ltr",
        nodes: [
          { id: "human", label: "Human" },
          { id: "gateway", label: "Telegram Gateway" },
          { id: "d1", label: "D1" },
          { id: "runtime", label: "Agent Runtime" },
          { id: "persona", label: "Persona Bots" },
          { id: "memory", label: "Memory / RAG" },
        ],
        edges: [
          { from: "human", to: "gateway" },
          { from: "gateway", to: "d1" },
          { from: "d1", to: "runtime" },
          { from: "runtime", to: "persona" },
          { from: "memory", to: "runtime" },
        ],
        groups: [],
        notes: ["D1 remains canonical; Telegram is an ingress and projection layer."],
      },
    });
    const artifact = await this.diagrams.render(created.artifact.id);
    return { reused: false, artifact: jsonObject(artifact) };
  }

  async listFiles(input: { readonly query?: string | null; readonly logicalPath?: string | null; readonly includeDeleted?: boolean; readonly limit?: string | null } = {}): Promise<readonly JsonObject[]> {
    const limit = limitValue(input.limit ?? null, 50, 100);
    const query = safeSearch(input.query ?? null);
    if (query) {
      const matches = await this.search.search(query, { topK: limit, sourceKinds: ["document"] });
      return matches.map((match) => ({
        id: match.sourceId, title: match.title, logicalPath: match.pathOrUrl,
        excerpt: match.excerpt, authority: match.authority, score: match.score, updatedAt: match.updatedAt,
        sourceType: match.type, provenance: match.provenance,
      }));
    }
    const documents = await this.documents.list({ actor: { system: true }, includeDeleted: input.includeDeleted === true, limit });
    const logicalPath = input.logicalPath?.trim();
    return documents
      .filter((document) => !logicalPath || document.logicalPath.startsWith(logicalPath))
      .map((document) => ({ ...document, deleted: document.deletedAt !== null }));
  }

  async fileDetail(documentId: string): Promise<JsonObject> {
    const document = await this.repositories.documents.getWithCurrentVersion(documentId);
    const [versions, shares, references] = await Promise.all([
      this.repositories.documents.listVersions(documentId, 100),
      this.database.prepare(
        `SELECT ds.agent_id, a.display_name, ds.granted_by_agent_id, ds.created_at, ds.revoked_at
         FROM document_shares ds LEFT JOIN agents a ON a.id = ds.agent_id
         WHERE ds.document_id = ? ORDER BY ds.created_at DESC`,
      ).bind(documentId).all<Row>(),
      this.database.prepare(
        `SELECT dr.*, t.title AS thread_title FROM document_references dr LEFT JOIN threads t ON t.id = dr.thread_id
         WHERE dr.document_id = ? ORDER BY dr.created_at DESC LIMIT 50`,
      ).bind(documentId).all<Row>(),
    ]);
    return {
      document: jsonObject(document.document),
      currentVersion: jsonValue(document.currentVersion),
      versions: jsonValue(versions),
      shares: jsonRows(shares.results),
      references: jsonRows(references.results),
    };
  }

  async createFile(input: { readonly logicalPath: string; readonly title: string; readonly contentMarkdown: string; readonly tags?: readonly string[] }): Promise<JsonObject> {
    return jsonObject(await this.documents.create({ actor: { system: true }, ...input }));
  }

  async editFile(documentId: string, contentMarkdown: string, changeSummary?: string): Promise<JsonObject> {
    const document = await this.repositories.documents.getWithCurrentVersion(documentId);
    return jsonObject(await this.documents.edit({ actor: { system: true }, logicalPath: document.document.logicalPath, contentMarkdown, changeSummary }));
  }

  async deleteFile(documentId: string): Promise<void> {
    const document = await this.repositories.documents.getById(documentId);
    await this.documents.delete(document.logicalPath, { system: true });
  }

  async restoreFile(documentId: string): Promise<JsonObject> {
    const document = await this.repositories.documents.getById(documentId);
    return jsonObject(await this.documents.restore(document.logicalPath, { system: true }));
  }

  async listKnowledge(): Promise<readonly JsonObject[]> {
    const sources = await this.repositories.knowledgeSources.listAll(50);
    const rows = await this.database.prepare(
      `SELECT ks.id, COUNT(kc.id) AS chunk_count, d.title AS document_title
       FROM knowledge_sources ks LEFT JOIN knowledge_chunks kc ON kc.source_id = ks.id
       LEFT JOIN documents d ON d.id = ks.document_id GROUP BY ks.id`,
    ).all<Row>();
    const counts = new Map(rows.results.map((row) => [stringValue(row.id), row]));
    return sources.map((source) => {
      const count = counts.get(source.id);
      return { ...source, chunkCount: numberValue(count?.chunk_count), documentTitle: nullableString(count?.document_title) };
    });
  }

  async knowledgeDetail(sourceId: string): Promise<JsonObject> {
    const source = await this.database.prepare("SELECT * FROM knowledge_sources WHERE id = ?").bind(sourceId).first<Row>();
    if (!source) throw new ValidationError("knowledge source was not found");
    const chunks = await this.repositories.knowledgeSources.listChunks(sourceId, 100);
    return { ...jsonObject(source), metadata: objectValue(source.metadata_json), chunks: jsonValue(chunks) };
  }

  async createKnowledgeSyncJob(sourceKey: string): Promise<JsonObject> {
    const definition = officialSourceByKey(sourceKey);
    if (!definition) throw new ValidationError("knowledge source is not on the official allowlist");
    const job = await this.repositories.jobs.create({
      jobType: "knowledge.sync_source",
      payload: { sourceKey },
      idempotencyKey: `admin-knowledge-sync:${sourceKey}:${Math.floor(Date.now() / 3_600_000)}`,
      dueAt: nowIso(),
      priority: 70,
      maxAttempts: 2,
    });
    return jsonObject(job);
  }

  async reputationOverview(domain?: string | null): Promise<readonly JsonObject[]> {
    const normalized = domain?.trim() || null;
    const result = await this.database.prepare(
      `SELECT rds.*, a.display_name, a.slug, a.rank AS global_rank,
        (SELECT COUNT(*) FROM reputation_events re WHERE re.agent_id = rds.agent_id AND re.domain = rds.domain) AS event_count,
        (SELECT MAX(rs.captured_at) FROM reputation_snapshots rs WHERE rs.agent_id = rds.agent_id AND rs.domain = rds.domain) AS last_change
       FROM reputation_domain_state rds JOIN agents a ON a.id = rds.agent_id
       WHERE a.is_supervisor = 0 AND a.deleted_at IS NULL AND (? IS NULL OR rds.domain = ?)
       ORDER BY rds.rank DESC, a.display_name ASC LIMIT 200`,
    ).bind(normalized, normalized).all<Row>();
    return result.results.map((row) => ({
      agentId: stringValue(row.agent_id), agentName: stringValue(row.display_name), slug: stringValue(row.slug),
      domain: stringValue(row.domain), rank: numberValue(row.rank), globalRank: numberValue(row.global_rank),
      epistemic: numberValue(row.epistemic), contribution: numberValue(row.contribution), outcome: numberValue(row.outcome), collaboration: numberValue(row.collaboration),
      evidenceCount: numberValue(row.evidence_count), eventCount: numberValue(row.event_count), lastChange: nullableString(row.last_change), updatedAt: stringValue(row.updated_at),
    }));
  }

  async reputationDetail(agentId: string): Promise<JsonObject> {
    const agent = await this.repositories.agents.getById(agentId);
    const [states, snapshots, evidence, evaluations, feedback] = await Promise.all([
      this.repositories.reputation.listDomainStates(agentId),
      this.database.prepare("SELECT * FROM reputation_snapshots WHERE agent_id = ? ORDER BY captured_at DESC LIMIT 100").bind(agentId).all<Row>(),
      this.database.prepare("SELECT * FROM reputation_events WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100").bind(agentId).all<Row>(),
      this.database.prepare("SELECT * FROM evaluations WHERE target_agent_id = ? ORDER BY created_at DESC LIMIT 100").bind(agentId).all<Row>(),
      this.database.prepare(
        `SELECT pf.*, a.display_name AS reviewer_name FROM peer_feedback pf LEFT JOIN agents a ON a.id = pf.reviewer_agent_id
         WHERE pf.target_agent_id = ? ORDER BY pf.created_at DESC LIMIT 100`,
      ).bind(agentId).all<Row>(),
    ]);
    return { agentId, agentName: agent.displayName, rank: agent.rank, states: jsonValue(states), snapshots: jsonRows(snapshots.results), evidence: jsonRows(evidence.results), evaluations: jsonRows(evaluations.results), feedback: jsonRows(feedback.results) };
  }

  async godOverview(): Promise<JsonObject> {
    const [reviews, directives] = await Promise.all([
      this.database.prepare("SELECT * FROM god_reviews ORDER BY created_at DESC LIMIT 20").all<Row>(),
      this.database.prepare(
        `SELECT gd.*, a.display_name AS agent_name, t.title AS thread_title
         FROM god_directives gd LEFT JOIN agents a ON a.id = gd.target_agent_id LEFT JOIN threads t ON t.id = gd.target_thread_id
         ORDER BY CASE gd.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, gd.created_at DESC LIMIT 100`,
      ).all<Row>(),
    ]);
    return {
      latest: reviews.results[0] ? this.mapGodReview(reviews.results[0]) : null,
      reviews: reviews.results.map((row) => this.mapGodReview(row)),
      directives: jsonRows(directives.results),
      configuration: {
        provider: this.runtimeConfig.godProvider ?? "not configured",
        model: this.runtimeConfig.godModel ?? "not configured",
        reasoningEffort: this.runtimeConfig.godReasoningEffort ?? "not configured",
        configured: this.runtimeConfig.godConfigured === true,
        normalProvider: this.runtimeConfig.normalProvider ?? "not configured",
        normalModel: this.runtimeConfig.normalModel ?? "not configured",
        normalReasoningEffort: this.runtimeConfig.normalReasoningEffort ?? "not configured",
        normalConfigured: this.runtimeConfig.normalConfigured === true,
        nebulaFallback: {
          provider: "nebula",
          model: this.runtimeConfig.nebulaModel ?? "not configured",
          configured: this.runtimeConfig.nebulaConfigured === true,
          active: this.runtimeConfig.normalProvider === "nebula",
        },
        transport: "gateway",
        godTelegramBot: false,
      },
    };
  }

  async godDetail(reviewId: string): Promise<JsonObject> {
    const review = await this.database.prepare("SELECT * FROM god_reviews WHERE id = ?").bind(reviewId).first<Row>();
    if (!review) throw new ValidationError("GOD review was not found");
    const [directives, evaluations, evidence] = await Promise.all([
      this.database.prepare("SELECT * FROM god_directives WHERE review_id = ? ORDER BY priority DESC, created_at ASC").bind(reviewId).all<Row>(),
      this.database.prepare("SELECT * FROM evaluations WHERE evaluation_type = 'god' AND json_extract(scores_json, '$.reviewId') = ? ORDER BY created_at DESC").bind(reviewId).all<Row>(),
      this.database.prepare("SELECT * FROM reputation_events WHERE source_type = 'god_review' AND source_id = ? ORDER BY created_at DESC").bind(reviewId).all<Row>(),
    ]);
    return { review: this.mapGodReview(review), directives: jsonRows(directives.results), evaluations: jsonRows(evaluations.results), evidence: jsonRows(evidence.results) };
  }

  async listSystem(): Promise<JsonObject> {
    const [jobs, schedules, providers, telegram, knowledge, errors, audit, counts, turns, artifacts, taskState] = await Promise.all([
      this.database.prepare(
        `SELECT j.id, j.job_type, j.status, j.attempt_count, j.max_attempts, j.due_at, j.created_at, j.updated_at, j.completed_at, j.last_error,
                j.lease_owner, j.lease_expires_at,
                json_extract(j.payload_json, '$.threadId') AS thread_id,
                t.title AS thread_title, a.display_name AS agent_name
         FROM jobs j LEFT JOIN threads t ON t.id = json_extract(j.payload_json, '$.threadId')
         LEFT JOIN agents a ON a.id = json_extract(j.payload_json, '$.agentId')
         ORDER BY j.created_at DESC LIMIT 80`,
      ).all<Row>(),
      this.database.prepare("SELECT * FROM scheduled_jobs ORDER BY next_run_at ASC LIMIT 30").all<Row>(),
      this.database.prepare(
        `SELECT provider_name, model_name,
                json_extract(metadata_json, '$.reasoningEffort') AS reasoning_effort,
                status, COUNT(*) AS calls,
                SUM(COALESCE(prompt_tokens,0)) AS input_tokens,
                SUM(COALESCE(completion_tokens,0)) AS output_tokens,
                SUM(COALESCE(total_tokens,0)) AS tokens,
                AVG(duration_ms) AS average_latency_ms, MAX(created_at) AS last_call
         FROM provider_usage GROUP BY provider_name, model_name, reasoning_effort, status ORDER BY last_call DESC LIMIT 20`,
      ).all<Row>(),
      this.database.prepare(
        `SELECT id, status, bot_alias, agent_id, thread_id, attempt_count, next_attempt_at, last_error, created_at, sent_at
         FROM telegram_outbound ORDER BY created_at DESC LIMIT 40`,
      ).all<Row>(),
      this.database.prepare("SELECT id, canonical_key, title, uri, status, last_successful_fetch_at, last_attempted_at, error_summary, content_hash, updated_at FROM knowledge_sources ORDER BY title ASC LIMIT 20").all<Row>(),
      this.database.prepare(
        `SELECT 'job' AS kind, id, job_type AS title, last_error AS summary, updated_at AS occurred_at FROM jobs WHERE status IN ('failed','retry_scheduled')
         UNION ALL SELECT 'provider', id, provider_name, error_summary, created_at FROM provider_usage WHERE status = 'failed'
         UNION ALL SELECT 'telegram', id, bot_alias, last_error, created_at FROM telegram_outbound WHERE status = 'failed'
         ORDER BY occurred_at DESC LIMIT 60`,
      ).all<Row>(),
      this.database.prepare(
        `SELECT al.id, al.action, al.entity_type, al.entity_id, al.payload_json, al.created_at, al.admin_session_id
         FROM audit_log al WHERE al.admin_session_id IS NOT NULL ORDER BY al.created_at DESC LIMIT 80`,
      ).all<Row>(),
      this.pressureSummary(),
      this.database.prepare(
        `SELECT status, json_extract(metadata_json, '$.intent') AS intent, COUNT(*) AS count,
                MAX(created_at) AS last_at
         FROM agent_turns GROUP BY status, intent ORDER BY last_at DESC LIMIT 40`,
      ).all<Row>(),
      this.database.prepare(
        `SELECT id, artifact_type, title, status, render_status, delivery_status,
                render_attempt_count, render_error, delivery_error, thread_id,
                created_by_agent_id, created_at, updated_at
         FROM artifacts ORDER BY updated_at DESC LIMIT 50`,
      ).all<Row>(),
      this.database.prepare(
        `SELECT status, blocking, projection_status, COUNT(*) AS count
         FROM human_tasks WHERE deleted_at IS NULL GROUP BY status, blocking, projection_status
         ORDER BY count DESC LIMIT 30`,
      ).all<Row>(),
    ]);
    const hasRecentProviderFailure = providers.results.some((row) => stringValue(row.status) === "failed");
    const hasTelegramFailure = telegram.results.some((row) => stringValue(row.status) === "failed");
    const hasKnowledgeFailure = knowledge.results.some((row) => stringValue(row.status) === "failed");
    const hasDiagramFailure = artifacts.results.some((row) => ["failed", "quota_exhausted"].includes(stringValue(row.render_status)));
    const queuedJobs = jobs.results.filter((row) => ["pending", "retry_scheduled"].includes(stringValue(row.status))).length;
    const providerSummary = providers.results.map((row) => ({
      ...row,
      estimated_cost_usd: estimatedOpenAICostUsd(row.model_name, row.input_tokens, row.output_tokens),
    }));
    return {
      generatedAt: nowIso(), jobs: jsonRows(jobs.results), schedules: jsonRows(schedules.results),
      providers: jsonRows(providerSummary),
      providerConfiguration: {
        normal: {
          provider: this.runtimeConfig.normalProvider ?? "not configured",
          model: this.runtimeConfig.normalModel ?? "not configured",
          reasoningEffort: this.runtimeConfig.normalReasoningEffort ?? "not configured",
          configured: this.runtimeConfig.normalConfigured === true,
        },
        god: {
          provider: this.runtimeConfig.godProvider ?? "not configured",
          model: this.runtimeConfig.godModel ?? "not configured",
          reasoningEffort: this.runtimeConfig.godReasoningEffort ?? "not configured",
          configured: this.runtimeConfig.godConfigured === true,
        },
        nebulaFallback: {
          provider: "nebula",
          model: this.runtimeConfig.nebulaModel ?? "not configured",
          configured: this.runtimeConfig.nebulaConfigured === true,
          active: this.runtimeConfig.normalProvider === "nebula",
        },
      },
      telegram: jsonRows(telegram.results),
      knowledge: jsonRows(knowledge.results), errors: errors.results.map((row) => ({ ...row, category: this.errorCategory(row) })),
      audit: audit.results.map((row) => ({ ...row, payload: objectValue(row.payload_json) })), pressure: counts,
      turns: jsonRows(turns.results), artifacts: jsonRows(artifacts.results), humanTasks: jsonRows(taskState.results),
      health: {
        normalAgentProvider: this.healthState(hasRecentProviderFailure, "provider"),
        godProvider: this.runtimeConfig.godConfigured === true ? this.healthState(hasRecentProviderFailure, "provider") : "attention",
        telegram: this.runtimeConfig.telegramConfigured === true ? (hasTelegramFailure ? "degraded" : "healthy") : "attention",
        queueJobs: queuedJobs > 10 ? "degraded" : "healthy",
        knowledgeSync: hasKnowledgeFailure ? "attention" : "healthy",
        humanTasks: taskState.results.some((row) => stringValue(row.status) === "blocked") ? "attention" : "healthy",
        diagrams: hasDiagramFailure ? "attention" : "healthy",
      },
    };
  }

  async settings(): Promise<JsonObject> {
    return {
      items: jsonValue((await listAdminSettings(this.database)).map((setting) => jsonObject(setting))),
      configuration: {
        telegramConfigured: this.runtimeConfig.telegramConfigured === true,
        normalProvider: this.runtimeConfig.normalProvider ?? "not configured",
        normalModel: this.runtimeConfig.normalModel ?? "not configured",
        normalReasoningEffort: this.runtimeConfig.normalReasoningEffort ?? "not configured",
        normalConfigured: this.runtimeConfig.normalConfigured === true,
        openaiConfigured: this.runtimeConfig.openaiConfigured === true,
        nebulaConfigured: this.runtimeConfig.nebulaConfigured === true,
        godConfigured: this.runtimeConfig.godConfigured === true,
        adminConfigured: this.runtimeConfig.adminConfigured === true,
      },
    };
  }

  async updateSetting(key: string, value: unknown, sessionId: string): Promise<JsonObject> {
    return jsonObject(await setAdminSetting(this.database, key, value, sessionId));
  }

  async resetSetting(key: string, sessionId: string): Promise<JsonObject> {
    return jsonObject(await resetAdminSetting(this.database, key, sessionId));
  }

  async activity(limit = 30): Promise<readonly JsonObject[]> {
    return this.listActivity(limit);
  }

  async listAudit(limit = 80): Promise<readonly JsonObject[]> {
    const result = await this.database.prepare(
      `SELECT id, action, entity_type, entity_id, payload_json, created_at, admin_session_id
       FROM audit_log WHERE admin_session_id IS NOT NULL ORDER BY created_at DESC LIMIT ?`,
    ).bind(Math.min(Math.max(limit, 1), 100)).all<Row>();
    return result.results.map((row) => ({ ...row, payload: objectValue(row.payload_json) }));
  }

  async updateHumanTask(id: string, status: string, resolution?: string, responderUserId?: string): Promise<JsonObject> {
    const allowed = ["open", "claimed", "in_progress", "blocked", "completed", "rejected", "cancelled"] as const;
    if (!allowed.includes(status as typeof allowed[number])) throw new ValidationError("invalid human task status");
    const result = await this.humanTasks.updateStatus({
      taskId: id,
      status: status as HumanTaskStatus,
      resolution,
      responderUserId,
      responseSource: "admin",
    });
    return { ...jsonObject(result.task), wakeJob: result.wakeJob ? jsonObject(result.wakeJob) : null };
  }

  async createPhase07HumanTaskSmoke(): Promise<JsonObject> {
    const requestKey = "phase07-live-human-task-smoke";
    const existing = await this.repositories.humanTasks.findByRequestKey(requestKey);
    if (existing) {
      return {
        reused: true,
        task: jsonObject(existing),
        threadId: existing.threadId,
      };
    }
    if (!this.runtimeConfig.telegramGroupId) {
      throw new ValidationError("Telegram workspace is not configured for the Phase 07 smoke task");
    }
    if (!this.runtimeConfig.telegramApplication) {
      throw new ValidationError("Telegram outbound application is not configured for the Phase 07 smoke task");
    }
    const chat = await this.repositories.chats.findByTelegramId(this.runtimeConfig.telegramGroupId);
    if (!chat) throw new ValidationError("the configured Telegram workspace is not present in D1");
    if (!chat.telegramChatId) throw new ValidationError("the configured Telegram workspace has no Telegram mapping");

    const thread = await this.repositories.threads.create({
      chatId: chat.id,
      title: "Phase 07 Human Task Smoke",
      state: "open",
      priority: 80,
      createdByAgentId: "agent-customer",
      metadata: { phase07Smoke: true, requestKey },
    });
    const result = await this.humanTasks.createFromAgent({
      threadId: thread.id,
      chatId: chat.id,
      requestedByAgentId: "agent-customer",
      title: "تست Human Task — Phase 07",
      description: "لطفاً در پاسخ به همین پیام بنویس: تست انسانی Phase 07 انجام شد.",
      reason: "برای بررسی مسیر درخواست انسانی → پاسخ → ادامه Thread.",
      priority: 80,
      blocking: true,
      requestKey,
      idempotencyKey: requestKey,
      metadata: { phase07Smoke: true },
    });
    return { reused: result.reused, task: jsonObject(result.task), threadId: thread.id };
  }

  async retryJob(id: string): Promise<JsonObject> {
    const job = await this.repositories.jobs.getById(id);
    const allowed = new Set([
      "telegram.interactive_message", "telegram.roll_call", "telegram.explicit_all_agents", "agent.ambient", "agent.deep_work", "human_task.wake",
      "knowledge.sync_source", "reputation.daily_score", "reputation.off_cycle_score", "god.review", "diagram.render",
    ]);
    if (!allowed.has(job.jobType)) throw new ValidationError("job type is not recoverable through the Observatory");
    return jsonObject(await this.repositories.jobs.retryFailed(id));
  }

  async recoverStaleJob(id: string): Promise<JsonObject> {
    return jsonObject(await this.repositories.jobs.recoverStaleById(id));
  }

  async updateDirective(id: string, status: string, resolution?: string): Promise<JsonObject> {
    const allowed = ["open", "acknowledged", "completed", "dismissed"];
    if (!allowed.includes(status)) throw new ValidationError("invalid GOD directive status");
    const updated = await this.database.prepare(
      `UPDATE god_directives SET status = ?, resolution = ?, acknowledged_at = CASE WHEN ? = 'acknowledged' THEN COALESCE(acknowledged_at, ?) ELSE acknowledged_at END,
       completed_at = CASE WHEN ? IN ('completed','dismissed') THEN COALESCE(completed_at, ?) ELSE completed_at END
       WHERE id = ?`,
    ).bind(status, resolution ?? null, status, nowIso(), status, nowIso(), id).run();
    if (updated.meta.changes !== 1) throw new ValidationError("GOD directive was not found");
    const row = await this.database.prepare("SELECT * FROM god_directives WHERE id = ?").bind(id).first<Row>();
    if (!row) throw new ValidationError("GOD directive was not found");
    return jsonObject(row);
  }

  async enqueueJob(input: { readonly jobType: string; readonly payload: JsonObject; readonly idempotencyKey: string; readonly priority?: number }): Promise<JsonObject> {
    return jsonObject(await this.repositories.jobs.create({ jobType: input.jobType, payload: input.payload, idempotencyKey: input.idempotencyKey, dueAt: nowIso(), priority: input.priority ?? 70, maxAttempts: 2 }));
  }

  private healthState(hasFailure: boolean, _kind: "provider"): "healthy" | "degraded" {
    return hasFailure ? "degraded" : "healthy";
  }

  private errorCategory(row: Row): string {
    const kind = stringValue(row.kind);
    if (kind === "provider") return "provider_failure";
    if (kind === "telegram") return "telegram_delivery";
    if (kind === "job") {
      const type = stringValue(row.title);
      if (type === "human_task.wake") return "human_task_mapping";
      if (type === "knowledge.sync_source") return "knowledge_fetch";
      if (type === "god.review") return "god_execution";
      if (type === "diagram.render") return "diagram_render_failed";
    }
    return "runtime_validation";
  }

  private async latestGodReview(): Promise<JsonObject | null> {
    const row = await this.database.prepare("SELECT * FROM god_reviews ORDER BY created_at DESC LIMIT 1").first<Row>();
    return row ? this.mapGodReview(row) : null;
  }

  private mapGodReview(row: Row): JsonObject {
    const findings = objectValue(row.findings_json);
    const briefing = objectValue(row.briefing_json);
    const directives = Array.isArray(findings.directives) ? findings.directives : [];
    const evaluations = Array.isArray(findings.agentEvaluations) ? findings.agentEvaluations : [];
    return {
      id: stringValue(row.id), status: stringValue(row.status), summary: nullableString(row.summary),
      findings, briefing, provider: nullableString(row.provider_name), model: nullableString(row.model_name),
      repairAttempts: numberValue(row.repair_attempts), publicMessageId: nullableString(row.public_message_id),
      directiveCount: directives.length, evaluationCount: evaluations.length,
      createdAt: stringValue(row.created_at), completedAt: nullableString(row.completed_at), failureSummary: nullableString(row.failure_summary),
    };
  }

  private async listActivity(limit: number): Promise<readonly JsonObject[]> {
    const result = await this.database.prepare(
      `SELECT e.id, e.event_type, e.aggregate_type, e.aggregate_id, e.payload_json, e.occurred_at,
              COALESCE(a.display_name, u.display_name, 'System') AS actor_name,
              t.title AS thread_title
       FROM events e LEFT JOIN agents a ON a.id = e.actor_agent_id LEFT JOIN users u ON u.id = e.actor_user_id
       LEFT JOIN threads t ON t.id = e.thread_id
       ORDER BY e.occurred_at DESC LIMIT ?`,
    ).bind(Math.min(Math.max(limit, 1), 50)).all<Row>();
    return result.results.map((row) => ({ ...row, payload: objectValue(row.payload_json) }));
  }

  private async pressureSummary(): Promise<JsonObject> {
    const [jobs, turns, providerCalls, documents, chunks, tasks, directives] = await Promise.all([
      this.database.prepare("SELECT COUNT(*) AS value FROM jobs WHERE created_at >= datetime('now','-1 day')").first<Row>(),
      this.database.prepare("SELECT COUNT(*) AS value FROM agent_turns WHERE created_at >= datetime('now','-1 day')").first<Row>(),
      this.database.prepare("SELECT COUNT(*) AS value FROM provider_usage WHERE created_at >= datetime('now','-1 day')").first<Row>(),
      this.database.prepare("SELECT COUNT(*) AS value FROM documents WHERE deleted_at IS NULL").first<Row>(),
      this.database.prepare("SELECT COUNT(*) AS value FROM knowledge_chunks").first<Row>(),
      this.database.prepare("SELECT COUNT(*) AS value FROM human_tasks WHERE deleted_at IS NULL AND status IN ('open','claimed','in_progress','blocked')").first<Row>(),
      this.database.prepare("SELECT COUNT(*) AS value FROM god_directives WHERE status IN ('open','acknowledged')").first<Row>(),
    ]);
    const failed = await this.database.prepare("SELECT COUNT(*) AS value FROM jobs WHERE status IN ('failed','retry_scheduled')").first<Row>();
    const active = await this.database.prepare("SELECT COUNT(*) AS value FROM agent_turns WHERE status = 'running'").first<Row>();
    return {
      jobsDay: numberValue(jobs?.value), agentTurnsDay: numberValue(turns?.value), providerCallsDay: numberValue(providerCalls?.value),
      documents: numberValue(documents?.value), knowledgeChunks: numberValue(chunks?.value), openHumanTasks: numberValue(tasks?.value),
      openGodDirectives: numberValue(directives?.value), failedJobs: numberValue(failed?.value), activeTurns: numberValue(active?.value),
      cloudflareQuota: "not measured; application-observed activity only",
    };
  }
}

function itemPriority(priority: number): string {
  return priority >= 80 ? "high" : priority >= 60 ? "normal" : "low";
}

export function adminServices(database: D1Database, runtimeConfig: AdminRuntimeDisplayConfig = {}): AdminObservatoryService {
  const repositories = createRepositories(database);
  return new AdminObservatoryService(repositories.database, repositories, runtimeConfig);
}

export function isThreadState(value: string): value is ThreadState {
  return ["open", "exploring", "debating", "evidence_gathering", "developing", "synthesizing", "human_required", "blocked", "decided", "rejected", "parked", "reopened"].includes(value);
}
