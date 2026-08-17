import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireNonEmpty } from "../validation";
import type {
  AgentRequestRecord,
  AgentVoteRecord,
  CreateAgentRequestInput,
  CreateAgentVoteInput,
} from "../types";

interface AgentRequestRow {
  id: string;
  thread_id: string;
  job_id: string | null;
  agent_turn_id: string | null;
  requested_by_agent_id: string;
  requested_agent_id: string;
  status: AgentRequestRecord["status"];
  request_text: string;
  metadata_json: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface AgentVoteRow {
  id: string;
  thread_id: string;
  agent_turn_id: string;
  agent_id: string;
  option_key: string;
  confidence: number;
  rationale: string | null;
  metadata_json: string;
  idempotency_key: string;
  created_at: string;
}

function mapRequest(row: AgentRequestRow): AgentRequestRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    jobId: toNullableString(row.job_id),
    agentTurnId: toNullableString(row.agent_turn_id),
    requestedByAgentId: row.requested_by_agent_id,
    requestedAgentId: row.requested_agent_id,
    status: row.status,
    requestText: row.request_text,
    metadata: toJsonObject(row.metadata_json, "agent_requests.metadata_json"),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: toNullableString(row.completed_at),
  };
}

function mapVote(row: AgentVoteRow): AgentVoteRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    agentTurnId: row.agent_turn_id,
    agentId: row.agent_id,
    optionKey: row.option_key,
    confidence: toNumber(row.confidence, "agent_votes.confidence"),
    rationale: toNullableString(row.rationale),
    metadata: toJsonObject(row.metadata_json, "agent_votes.metadata_json"),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

export class AgentRequestRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateAgentRequestInput): Promise<AgentRequestRecord> {
    const requestText = requireNonEmpty(input.requestText, "agentRequest.requestText");
    const idempotencyKey = requireNonEmpty(input.idempotencyKey, "agentRequest.idempotencyKey");
    await this.database
      .prepare(
        `INSERT INTO agent_requests (
          id, thread_id, job_id, agent_turn_id, requested_by_agent_id,
          requested_agent_id, request_text, metadata_json, idempotency_key,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(
        input.id ?? createId("agent-request"),
        input.threadId,
        input.jobId ?? null,
        input.agentTurnId ?? null,
        input.requestedByAgentId,
        input.requestedAgentId,
        requestText,
        encodeObject(input.metadata, "agentRequest.metadata"),
        idempotencyKey,
        nowIso(),
        nowIso(),
      )
      .run();

    return this.getByIdempotencyKey(idempotencyKey);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<AgentRequestRecord> {
    const row = await this.database
      .prepare("SELECT * FROM agent_requests WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<AgentRequestRow>();
    if (!row) {
      throw new NotFoundError("agent request idempotency key", idempotencyKey);
    }
    return mapRequest(row);
  }

  async listOpenForThread(threadId: string, limit = 20): Promise<readonly AgentRequestRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError("agent request list limit must be between 1 and 100");
    }
    const result = await this.database
      .prepare(
        `SELECT * FROM agent_requests
         WHERE thread_id = ? AND status = 'open'
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .bind(threadId, limit)
      .all<AgentRequestRow>();
    return result.results.map(mapRequest);
  }

  /**
   * A REQUEST_AGENT hint is one-shot routing state. Once the requested Agent
   * receives a selected turn, remove it from the open-request pool so an old
   * request cannot bias later bursts indefinitely.
   */
  async acceptOpenForThreadTarget(input: {
    readonly threadId: string;
    readonly requestedAgentId: string;
    readonly minimumCreatedAt?: string | null;
  }): Promise<boolean> {
    const minimumCreatedAt = input.minimumCreatedAt ?? null;
    const row = await this.database
      .prepare(
        `SELECT id FROM agent_requests
         WHERE thread_id = ?
           AND requested_agent_id = ?
           AND status = 'open'
           AND (? IS NULL OR created_at >= ?)
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .bind(input.threadId, input.requestedAgentId, minimumCreatedAt, minimumCreatedAt)
      .first<{ id: string }>();
    if (!row) return false;

    const updated = await this.database
      .prepare(
        `UPDATE agent_requests
         SET status = 'accepted', updated_at = ?
         WHERE id = ? AND status = 'open'`,
      )
      .bind(nowIso(), row.id)
      .run();
    return updated.meta.changes === 1;
  }
}

export class AgentVoteRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateAgentVoteInput): Promise<AgentVoteRecord> {
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new ValidationError("agentVote.confidence must be between 0 and 1");
    }
    const optionKey = requireNonEmpty(input.optionKey, "agentVote.optionKey");
    const idempotencyKey = requireNonEmpty(input.idempotencyKey, "agentVote.idempotencyKey");
    await this.database
      .prepare(
        `INSERT INTO agent_votes (
          id, thread_id, agent_turn_id, agent_id, option_key, confidence,
          rationale, metadata_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(
        input.id ?? createId("agent-vote"),
        input.threadId,
        input.agentTurnId,
        input.agentId,
        optionKey,
        input.confidence,
        input.rationale ?? null,
        encodeObject(input.metadata, "agentVote.metadata"),
        idempotencyKey,
        nowIso(),
      )
      .run();

    return this.getByIdempotencyKey(idempotencyKey);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<AgentVoteRecord> {
    const row = await this.database
      .prepare("SELECT * FROM agent_votes WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<AgentVoteRow>();
    if (!row) {
      throw new NotFoundError("agent vote idempotency key", idempotencyKey);
    }
    return mapVote(row);
  }
}
