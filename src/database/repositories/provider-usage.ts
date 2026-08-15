import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireNonEmpty } from "../validation";
import type { CreateProviderUsageInput, ProviderUsageRecord } from "../types";

interface ProviderUsageRow {
  id: string;
  provider_name: string;
  model_name: string;
  job_id: string | null;
  agent_turn_id: string | null;
  request_id: string | null;
  status: ProviderUsageRecord["status"];
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  error_summary: string | null;
  idempotency_key: string;
  metadata_json: string;
  created_at: string;
}

function nullableNumber(value: number | null, fieldName: string): number | null {
  return value === null ? null : toNumber(value, fieldName);
}

function mapUsage(row: ProviderUsageRow): ProviderUsageRecord {
  return {
    id: row.id,
    providerName: row.provider_name,
    modelName: row.model_name,
    jobId: toNullableString(row.job_id),
    agentTurnId: toNullableString(row.agent_turn_id),
    requestId: toNullableString(row.request_id),
    status: row.status,
    promptTokens: nullableNumber(row.prompt_tokens, "provider_usage.prompt_tokens"),
    completionTokens: nullableNumber(row.completion_tokens, "provider_usage.completion_tokens"),
    totalTokens: nullableNumber(row.total_tokens, "provider_usage.total_tokens"),
    durationMs: nullableNumber(row.duration_ms, "provider_usage.duration_ms"),
    errorSummary: toNullableString(row.error_summary),
    idempotencyKey: row.idempotency_key,
    metadata: toJsonObject(row.metadata_json, "provider_usage.metadata_json"),
    createdAt: row.created_at,
  };
}

export class ProviderUsageRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateProviderUsageInput): Promise<ProviderUsageRecord> {
    const id = input.id ?? createId("provider-usage");
    const providerName = requireNonEmpty(input.providerName, "providerUsage.providerName");
    const modelName = requireNonEmpty(input.modelName, "providerUsage.modelName");
    const idempotencyKey = requireNonEmpty(input.idempotencyKey, "providerUsage.idempotencyKey");
    for (const [value, field] of [
      [input.promptTokens, "promptTokens"],
      [input.completionTokens, "completionTokens"],
      [input.totalTokens, "totalTokens"],
      [input.durationMs, "durationMs"],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
        throw new ValidationError(`providerUsage.${field} must be a non-negative integer`);
      }
    }

    await this.database
      .prepare(
        `INSERT INTO provider_usage (
          id, provider_name, model_name, job_id, agent_turn_id, request_id,
          status, prompt_tokens, completion_tokens, total_tokens, duration_ms,
          error_summary, idempotency_key, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(
        id,
        providerName,
        modelName,
        input.jobId ?? null,
        input.agentTurnId ?? null,
        input.requestId ?? null,
        input.status,
        input.promptTokens ?? null,
        input.completionTokens ?? null,
        input.totalTokens ?? null,
        input.durationMs ?? null,
        input.errorSummary ?? null,
        idempotencyKey,
        encodeObject(input.metadata, "providerUsage.metadata"),
        nowIso(),
      )
      .run();

    return this.getByIdempotencyKey(idempotencyKey);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<ProviderUsageRecord> {
    const row = await this.database
      .prepare("SELECT * FROM provider_usage WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<ProviderUsageRow>();

    if (!row) {
      throw new NotFoundError("provider usage idempotency key", idempotencyKey);
    }

    return mapUsage(row);
  }
}
