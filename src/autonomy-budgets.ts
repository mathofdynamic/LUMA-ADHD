import type { DatabaseClient } from "./database/client";
import { FOUNDATION_GUARDRAILS } from "./guardrails";

/**
 * These limits protect the organization from accidental self-amplification.
 * They are application safety budgets, not claims about Cloudflare quotas.
 */
export type AutonomyBudgetKind =
  | "ambient"
  | "deep_work"
  | "god"
  | "knowledge"
  | "reputation";

export const AUTONOMY_BUDGET_DEFAULTS: Readonly<Record<AutonomyBudgetKind, number>> = Object.freeze({
  ambient: FOUNDATION_GUARDRAILS.ambientDailyJobBudget,
  deep_work: FOUNDATION_GUARDRAILS.deepWorkDailyJobBudget,
  god: FOUNDATION_GUARDRAILS.godDailyReviewBudget,
  knowledge: FOUNDATION_GUARDRAILS.knowledgeDailySyncBudget,
  reputation: FOUNDATION_GUARDRAILS.reputationDailyJobBudget,
});

const JOB_TYPES: Readonly<Record<AutonomyBudgetKind, readonly string[]>> = Object.freeze({
  ambient: ["agent.ambient"],
  deep_work: ["agent.deep_work"],
  god: ["god.review"],
  knowledge: ["knowledge.sync_source"],
  reputation: ["reputation.daily_score", "reputation.off_cycle_score"],
});

function utcDayBounds(asOf: string): readonly [string, string] {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) throw new Error("autonomy budget timestamp must be valid ISO");
  const start = new Date(timestamp);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);
  return [start.toISOString(), end.toISOString()];
}

export async function countDailyAutonomyJobs(
  database: DatabaseClient,
  kind: AutonomyBudgetKind,
  asOf: string,
): Promise<number> {
  const [start, end] = utcDayBounds(asOf);
  const placeholders = JOB_TYPES[kind].map(() => "?").join(", ");
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM jobs
       WHERE job_type IN (${placeholders}) AND created_at >= ? AND created_at < ?`,
    )
    .bind(...JOB_TYPES[kind], start, end)
    .first<{ count: number | string }>();
  const count = Number(row?.count ?? 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

export async function hasDailyAutonomyBudget(
  database: DatabaseClient,
  kind: AutonomyBudgetKind,
  limit: number,
  asOf: string,
): Promise<boolean> {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("autonomy budget limit must be a non-negative integer");
  return (await countDailyAutonomyJobs(database, kind, asOf)) < limit;
}

export function nextUtcDay(asOf: string): string {
  const [, end] = utcDayBounds(asOf);
  return end;
}
