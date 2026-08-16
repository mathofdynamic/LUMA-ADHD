import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toBoolean, toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireNonEmpty } from "../validation";
import type {
  AgentInterestRecord,
  AgentSpecialtyRecord,
  AgentConfigurationRecord,
  AgentRecord,
  CreateAgentInput,
} from "../types";
import type { JsonObject } from "../validation";

interface AgentRow {
  id: string;
  slug: string;
  display_name: string;
  specialty: string;
  specialty_description: string;
  soul: string;
  personality: string;
  rank: number;
  is_supervisor: number;
  is_active: number;
  config_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface AgentConfigurationRow {
  id: string;
  agent_id: string;
  version: number;
  provider_role: string;
  model_key: string | null;
  prompt_version: string | null;
  config_json: string;
  is_active: number;
  created_at: string;
}

function mapAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    specialty: row.specialty,
    specialtyDescription: row.specialty_description,
    soul: row.soul,
    personality: row.personality,
    rank: toNumber(row.rank, "agents.rank"),
    isSupervisor: toBoolean(row.is_supervisor),
    isActive: toBoolean(row.is_active),
    config: toJsonObject(row.config_json, "agents.config_json"),
    metadata: toJsonObject(row.metadata_json, "agents.metadata_json"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: toNullableString(row.deleted_at),
  };
}

function mapConfiguration(row: AgentConfigurationRow): AgentConfigurationRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    version: toNumber(row.version, "agent_configurations.version"),
    providerRole: row.provider_role,
    modelKey: toNullableString(row.model_key),
    promptVersion: toNullableString(row.prompt_version),
    config: toJsonObject(row.config_json, "agent_configurations.config_json"),
    isActive: toBoolean(row.is_active),
    createdAt: row.created_at,
  };
}

export interface AgentConfigurationInput {
  readonly agentId: string;
  readonly version: number;
  readonly providerRole: string;
  readonly modelKey?: string;
  readonly promptVersion?: string;
  readonly config?: import("../validation").JsonObject;
  readonly isActive?: boolean;
}

export interface UpdateAgentProfileInput {
  readonly agentId: string;
  readonly specialtyDescription: string;
  readonly soul: string;
  readonly personality: string;
  readonly interests?: readonly string[];
  readonly config?: JsonObject;
}

export class AgentRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateAgentInput): Promise<AgentRecord> {
    const id = input.id ?? createId("agent");
    const slug = requireNonEmpty(input.slug, "agent.slug");
    const displayName = requireNonEmpty(input.displayName, "agent.displayName");
    const specialty = requireNonEmpty(input.specialty, "agent.specialty");
    const rank = input.rank ?? 10;

    if (!Number.isFinite(rank) || rank < 0) {
      throw new ValidationError("agent.rank must be a non-negative number");
    }

    const timestamp = nowIso();
    await this.database
      .prepare(
        `INSERT INTO agents (
          id, slug, display_name, specialty, specialty_description, soul,
          personality, rank, is_supervisor, config_json, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        slug,
        displayName,
        specialty,
        input.specialtyDescription ?? "",
        input.soul ?? "",
        input.personality ?? "",
        rank,
        input.isSupervisor === true ? 1 : 0,
        encodeObject(input.config, "agent.config"),
        encodeObject(input.metadata, "agent.metadata"),
        timestamp,
        timestamp,
      )
      .run();

    return this.getById(id);
  }

  async getById(id: string): Promise<AgentRecord> {
    const row = await this.database
      .prepare("SELECT * FROM agents WHERE id = ?")
      .bind(id)
      .first<AgentRow>();

    if (!row) {
      throw new NotFoundError("agent", id);
    }

    return mapAgent(row);
  }

  async findBySlug(slug: string): Promise<AgentRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM agents WHERE slug = ? AND deleted_at IS NULL")
      .bind(slug)
      .first<AgentRow>();

    return row ? mapAgent(row) : null;
  }

  async listActive(limit = 100): Promise<readonly AgentRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ValidationError("agent list limit must be between 1 and 500");
    }

    const result = await this.database
      .prepare(
        `SELECT * FROM agents
         WHERE deleted_at IS NULL AND is_active = 1
         ORDER BY rank DESC, display_name ASC
         LIMIT ?`,
      )
      .bind(limit)
      .all<AgentRow>();

    return result.results.map(mapAgent);
  }

  async updateRank(agentId: string, rank: number, asOf = nowIso()): Promise<AgentRecord> {
    if (!Number.isFinite(rank) || rank < 0 || rank > 20) {
      throw new ValidationError("agent.rank must be between 0 and 20");
    }
    const result = await this.database.prepare(
      "UPDATE agents SET rank = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    ).bind(rank, asOf, agentId).run();
    if (result.meta.changes !== 1) throw new NotFoundError("agent", agentId);
    return this.getById(agentId);
  }

  async updateProfile(input: UpdateAgentProfileInput, asOf = nowIso()): Promise<AgentRecord> {
    const fields: readonly [string, string][] = [
      ["specialtyDescription", input.specialtyDescription],
      ["soul", input.soul],
      ["personality", input.personality],
    ];
    for (const [field, value] of fields) {
      if (typeof value !== "string" || value.length > 8_000) {
        throw new ValidationError(`agent.${field} must be a string under 8000 characters`);
      }
    }

    const current = await this.getById(input.agentId);
    const configuration = await this.database.prepare(
      "SELECT COALESCE(MAX(version), 0) AS version FROM agent_configurations WHERE agent_id = ?",
    ).bind(input.agentId).first<{ version: number }>();
    const nextVersion = Number(configuration?.version ?? 0) + 1;
    const nextConfigId = createId("agent-config");
    const configJson = encodeObject(input.config ?? current.config, "agent.config");
    const results = await this.database.batch([
      this.database.prepare(
        `UPDATE agents SET specialty_description = ?, soul = ?, personality = ?,
         config_json = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      ).bind(
        input.specialtyDescription,
        input.soul,
        input.personality,
        configJson,
        asOf,
        input.agentId,
      ),
      this.database.prepare(
        "UPDATE agent_configurations SET is_active = 0 WHERE agent_id = ? AND is_active = 1",
      ).bind(input.agentId),
      this.database.prepare(
        `INSERT INTO agent_configurations (
          id, agent_id, version, provider_role, model_key, prompt_version,
          config_json, is_active, created_at
        ) VALUES (?, ?, ?, 'normal_agent', ?, 'phase-06-admin', ?, 1, ?)`,
      ).bind(
        nextConfigId,
        input.agentId,
        nextVersion,
        typeof current.config.modelKey === "string" ? current.config.modelKey : null,
        configJson,
        asOf,
      ),
    ]);
    if (results[0]?.meta.changes !== 1) throw new NotFoundError("agent", input.agentId);

    if (input.interests !== undefined) {
      const normalized = input.interests
        .map((interest) => interest.trim())
        .filter((interest) => interest.length > 0 && interest.length <= 160)
        .slice(0, 30);
      await this.database.prepare("DELETE FROM agent_interests WHERE agent_id = ?").bind(input.agentId).run();
      for (let index = 0; index < normalized.length; index += 1) {
        await this.database.prepare(
          "INSERT INTO agent_interests (agent_id, interest, priority) VALUES (?, ?, ?)",
        ).bind(input.agentId, normalized[index], 100 - index).run();
      }
    }
    return this.getById(input.agentId);
  }

  async setActive(agentId: string, active: boolean, asOf = nowIso()): Promise<AgentRecord> {
    const result = await this.database.prepare(
      "UPDATE agents SET is_active = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    ).bind(active ? 1 : 0, asOf, agentId).run();
    if (result.meta.changes !== 1) throw new NotFoundError("agent", agentId);
    return this.getById(agentId);
  }

  async listSpecialties(agentId: string): Promise<readonly AgentSpecialtyRecord[]> {
    const result = await this.database
      .prepare(
        `SELECT agent_id, domain, description, priority, is_primary
         FROM agent_specialties
         WHERE agent_id = ?
         ORDER BY is_primary DESC, priority DESC, domain ASC`,
      )
      .bind(agentId)
      .all<{
        agent_id: string;
        domain: string;
        description: string;
        priority: number;
        is_primary: number;
      }>();

    return result.results.map((row) => ({
      agentId: row.agent_id,
      domain: row.domain,
      description: row.description,
      priority: Number(row.priority),
      isPrimary: row.is_primary === 1,
    }));
  }

  async listInterests(agentId: string): Promise<readonly AgentInterestRecord[]> {
    const result = await this.database
      .prepare(
        `SELECT agent_id, interest, priority
         FROM agent_interests
         WHERE agent_id = ?
         ORDER BY priority DESC, interest ASC`,
      )
      .bind(agentId)
      .all<{ agent_id: string; interest: string; priority: number }>();

    return result.results.map((row) => ({
      agentId: row.agent_id,
      interest: row.interest,
      priority: Number(row.priority),
    }));
  }

  async createConfiguration(input: AgentConfigurationInput): Promise<AgentConfigurationRecord> {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ValidationError("agent configuration version must be a positive integer");
    }

    const id = createId("agent-config");
    await this.database
      .prepare(
        `INSERT INTO agent_configurations (
          id, agent_id, version, provider_role, model_key, prompt_version,
          config_json, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.agentId,
        input.version,
        requireNonEmpty(input.providerRole, "agentConfiguration.providerRole"),
        input.modelKey ?? null,
        input.promptVersion ?? null,
        encodeObject(input.config, "agentConfiguration.config"),
        input.isActive === false ? 0 : 1,
      )
      .run();

    const row = await this.database
      .prepare("SELECT * FROM agent_configurations WHERE id = ?")
      .bind(id)
      .first<AgentConfigurationRow>();

    if (!row) {
      throw new NotFoundError("agent configuration", id);
    }

    return mapConfiguration(row);
  }
}
