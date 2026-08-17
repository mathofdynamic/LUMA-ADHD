import type { DatabaseClient } from "../database/client";
import { ValidationError } from "../database/errors";
import { encodeJson, type JsonValue } from "../database/validation";
import { FOUNDATION_GUARDRAILS } from "../guardrails";

export const ADMIN_SETTING_DEFINITIONS = {
  interactive_burst_turns: {
    label: "Interactive burst turns",
    description: "Normal-agent turns allowed in one human-triggered burst.",
    defaultValue: 6,
    min: 1,
    max: 6,
  },
  deep_work_turns: {
    label: "Deep-work turns",
    description: "Normal-agent turns allowed in an eligible deep-work burst.",
    defaultValue: 12,
    min: 1,
    max: 12,
  },
  scheduler_work_per_tick: {
    label: "Scheduler work per tick",
    description: "Maximum coarse autonomous opportunities created by one scheduler tick.",
    defaultValue: 3,
    min: 0,
    max: 3,
  },
  ambient_opportunity_interval_minutes: {
    label: "Ambient opportunity interval",
    description: "Minimum interval between an agent's ambient opportunities.",
    defaultValue: 240,
    min: 60,
    max: 1_440,
  },
  inactivity_recovery_hours: {
    label: "Inactivity recovery threshold",
    description: "Hours of useful silence before bounded recovery work becomes eligible.",
    defaultValue: FOUNDATION_GUARDRAILS.inactivityRecoveryHours,
    min: 6,
    max: 168,
  },
  knowledge_sync_cadence_hours: {
    label: "Knowledge sync cadence",
    description: "Target cadence for stale official LUMA source checks.",
    defaultValue: 24,
    min: 6,
    max: 168,
  },
  god_review_cadence_hours: {
    label: "GOD review cadence",
    description: "Target interval between supervisory reviews.",
    defaultValue: 12,
    min: 12,
    max: 48,
  },
  rag_max_acquisition_steps: {
    label: "RAG acquisition steps",
    description: "Maximum explicit memory/file acquisition operations for one turn.",
    defaultValue: 3,
    min: 0,
    max: 3,
  },
  rag_context_budget: {
    label: "RAG context budget",
    description: "Maximum retrieved characters reserved for one agent prompt.",
    defaultValue: 6_000,
    min: 2_000,
    max: 12_000,
  },
  recent_message_context_count: {
    label: "Recent message window",
    description: "Bounded recent-message count included in normal context.",
    defaultValue: FOUNDATION_GUARDRAILS.recentContextMessageLimit,
    min: 2,
    max: 20,
  },
  ambient_daily_job_budget: {
    label: "Ambient daily safety budget",
    description: "LUMA internal maximum ambient opportunities created per UTC day.",
    defaultValue: FOUNDATION_GUARDRAILS.ambientDailyJobBudget,
    min: 0,
    max: FOUNDATION_GUARDRAILS.ambientDailyJobBudget,
  },
  deep_work_daily_job_budget: {
    label: "Deep-work daily safety budget",
    description: "LUMA internal maximum deep-work jobs created per UTC day.",
    defaultValue: FOUNDATION_GUARDRAILS.deepWorkDailyJobBudget,
    min: 0,
    max: FOUNDATION_GUARDRAILS.deepWorkDailyJobBudget,
  },
  god_daily_review_budget: {
    label: "GOD daily safety budget",
    description: "LUMA internal maximum scheduled GOD review jobs created per UTC day.",
    defaultValue: FOUNDATION_GUARDRAILS.godDailyReviewBudget,
    min: 0,
    max: FOUNDATION_GUARDRAILS.godDailyReviewBudget,
  },
  knowledge_daily_sync_budget: {
    label: "Knowledge daily safety budget",
    description: "LUMA internal maximum scheduled knowledge sync jobs created per UTC day.",
    defaultValue: FOUNDATION_GUARDRAILS.knowledgeDailySyncBudget,
    min: 0,
    max: FOUNDATION_GUARDRAILS.knowledgeDailySyncBudget,
  },
  reputation_daily_job_budget: {
    label: "Reputation daily safety budget",
    description: "LUMA internal maximum scheduled reputation jobs created per UTC day.",
    defaultValue: FOUNDATION_GUARDRAILS.reputationDailyJobBudget,
    min: 0,
    max: FOUNDATION_GUARDRAILS.reputationDailyJobBudget,
  },
  reputation_calculation_cadence_hours: {
    label: "Reputation calculation cadence",
    description: "Minimum interval between scheduled reputation scoring runs.",
    defaultValue: 24,
    min: 24,
    max: 168,
  },
} as const;

export type AdminSettingKey = keyof typeof ADMIN_SETTING_DEFINITIONS;

export interface EffectiveRuntimeSettings {
  readonly interactiveBurstMaxTurns: number;
  readonly deepWorkMaxTurns: number;
  readonly schedulerWorkPerTick: number;
  readonly ambientOpportunityIntervalMinutes: number;
  readonly inactivityRecoveryHours: number;
  readonly knowledgeSyncCadenceHours: number;
  readonly godReviewCadenceHours: number;
  readonly reputationCalculationCadenceHours: number;
  readonly ragMaxAcquisitionSteps: number;
  readonly ragContextBudget: number;
  readonly recentMessageContextCount: number;
  readonly ambientDailyJobBudget: number;
  readonly deepWorkDailyJobBudget: number;
  readonly godDailyReviewBudget: number;
  readonly knowledgeDailySyncBudget: number;
  readonly reputationDailyJobBudget: number;
}

export const DEFAULT_RUNTIME_SETTINGS: EffectiveRuntimeSettings = Object.freeze({
  interactiveBurstMaxTurns: FOUNDATION_GUARDRAILS.interactiveBurstMaxTurns,
  deepWorkMaxTurns: FOUNDATION_GUARDRAILS.deepWorkMaxTurns,
  schedulerWorkPerTick: FOUNDATION_GUARDRAILS.schedulerWorkPerTick,
  ambientOpportunityIntervalMinutes: FOUNDATION_GUARDRAILS.ambientOpportunityIntervalMinutes,
  inactivityRecoveryHours: FOUNDATION_GUARDRAILS.inactivityRecoveryHours,
  knowledgeSyncCadenceHours: 24,
  godReviewCadenceHours: 12,
  reputationCalculationCadenceHours: 24,
  ragMaxAcquisitionSteps: 3,
  ragContextBudget: 6_000,
  recentMessageContextCount: FOUNDATION_GUARDRAILS.recentContextMessageLimit,
  ambientDailyJobBudget: FOUNDATION_GUARDRAILS.ambientDailyJobBudget,
  deepWorkDailyJobBudget: FOUNDATION_GUARDRAILS.deepWorkDailyJobBudget,
  godDailyReviewBudget: FOUNDATION_GUARDRAILS.godDailyReviewBudget,
  knowledgeDailySyncBudget: FOUNDATION_GUARDRAILS.knowledgeDailySyncBudget,
  reputationDailyJobBudget: FOUNDATION_GUARDRAILS.reputationDailyJobBudget,
});

const RUNTIME_SETTING_KEYS = {
  interactiveBurstMaxTurns: "interactive_burst_turns",
  deepWorkMaxTurns: "deep_work_turns",
  schedulerWorkPerTick: "scheduler_work_per_tick",
  ambientOpportunityIntervalMinutes: "ambient_opportunity_interval_minutes",
  inactivityRecoveryHours: "inactivity_recovery_hours",
  knowledgeSyncCadenceHours: "knowledge_sync_cadence_hours",
  godReviewCadenceHours: "god_review_cadence_hours",
  reputationCalculationCadenceHours: "reputation_calculation_cadence_hours",
  ragMaxAcquisitionSteps: "rag_max_acquisition_steps",
  ragContextBudget: "rag_context_budget",
  recentMessageContextCount: "recent_message_context_count",
  ambientDailyJobBudget: "ambient_daily_job_budget",
  deepWorkDailyJobBudget: "deep_work_daily_job_budget",
  godDailyReviewBudget: "god_daily_review_budget",
  knowledgeDailySyncBudget: "knowledge_daily_sync_budget",
  reputationDailyJobBudget: "reputation_daily_job_budget",
} as const satisfies Record<keyof EffectiveRuntimeSettings, AdminSettingKey>;

export async function loadEffectiveRuntimeSettings(database: DatabaseClient): Promise<EffectiveRuntimeSettings> {
  try {
    const records = await listAdminSettings(database);
    const values = new Map(records.map((record) => [record.key, record.value]));
    const read = <K extends keyof EffectiveRuntimeSettings>(key: K): number => {
      const value = values.get(RUNTIME_SETTING_KEYS[key]);
      return typeof value === "number" && Number.isInteger(value) ? value : DEFAULT_RUNTIME_SETTINGS[key];
    };
    return {
      interactiveBurstMaxTurns: read("interactiveBurstMaxTurns"),
      deepWorkMaxTurns: read("deepWorkMaxTurns"),
      schedulerWorkPerTick: read("schedulerWorkPerTick"),
      ambientOpportunityIntervalMinutes: read("ambientOpportunityIntervalMinutes"),
      inactivityRecoveryHours: read("inactivityRecoveryHours"),
      knowledgeSyncCadenceHours: read("knowledgeSyncCadenceHours"),
      godReviewCadenceHours: read("godReviewCadenceHours"),
      reputationCalculationCadenceHours: read("reputationCalculationCadenceHours"),
      ragMaxAcquisitionSteps: read("ragMaxAcquisitionSteps"),
      ragContextBudget: read("ragContextBudget"),
      recentMessageContextCount: read("recentMessageContextCount"),
      ambientDailyJobBudget: read("ambientDailyJobBudget"),
      deepWorkDailyJobBudget: read("deepWorkDailyJobBudget"),
      godDailyReviewBudget: read("godDailyReviewBudget"),
      knowledgeDailySyncBudget: read("knowledgeDailySyncBudget"),
      reputationDailyJobBudget: read("reputationDailyJobBudget"),
    };
  } catch {
    // Phase 00-05 databases do not have the Phase 06 table yet. The hard-coded
    // guardrails remain the safe fallback during rolling deployments/tests.
    return DEFAULT_RUNTIME_SETTINGS;
  }
}

export interface AdminSettingRecord {
  readonly key: AdminSettingKey;
  readonly label: string;
  readonly description: string;
  readonly value: number;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly overridden: boolean;
  readonly updatedAt: string | null;
}

interface SettingRow {
  key: string;
  value_json: string;
  updated_at: string;
}

function isSettingKey(value: string): value is AdminSettingKey {
  return Object.prototype.hasOwnProperty.call(ADMIN_SETTING_DEFINITIONS, value);
}

export function validateSettingValue(key: AdminSettingKey, value: unknown): number {
  const definition = ADMIN_SETTING_DEFINITIONS[key];
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < definition.min || numeric > definition.max) {
    throw new ValidationError(`${key} must be an integer between ${definition.min} and ${definition.max}`);
  }
  return numeric;
}

export async function listAdminSettings(database: DatabaseClient): Promise<readonly AdminSettingRecord[]> {
  const result = await database.prepare("SELECT key, value_json, updated_at FROM admin_settings ORDER BY key ASC").all<SettingRow>();
  const stored = new Map<string, SettingRow>(result.results.map((row) => [row.key, row]));
  return (Object.keys(ADMIN_SETTING_DEFINITIONS) as AdminSettingKey[]).map((key) => {
    const definition = ADMIN_SETTING_DEFINITIONS[key];
    const row = stored.get(key);
    let value: number = definition.defaultValue;
    if (row) {
      try {
        value = validateSettingValue(key, JSON.parse(row.value_json));
      } catch {
        value = definition.defaultValue;
      }
    }
    return {
      key,
      label: definition.label,
      description: definition.description,
      value,
      defaultValue: definition.defaultValue,
      min: definition.min,
      max: definition.max,
      overridden: row !== undefined,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export async function getAdminSetting(
  database: DatabaseClient,
  key: AdminSettingKey,
): Promise<number> {
  const definition = ADMIN_SETTING_DEFINITIONS[key];
  const row = await database.prepare("SELECT value_json FROM admin_settings WHERE key = ?").bind(key).first<{ value_json: string }>();
  if (!row) return definition.defaultValue;
  try {
    return validateSettingValue(key, JSON.parse(row.value_json));
  } catch {
    return definition.defaultValue;
  }
}

export async function setAdminSetting(
  database: DatabaseClient,
  key: string,
  value: unknown,
  sessionId: string,
): Promise<AdminSettingRecord> {
  if (!isSettingKey(key)) throw new ValidationError("unknown admin setting");
  const numeric = validateSettingValue(key, value);
  await database.prepare(
    `INSERT INTO admin_settings (key, value_json, updated_by_session_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_by_session_id = excluded.updated_by_session_id,
       updated_at = excluded.updated_at`,
  ).bind(key, encodeJson(numeric as JsonValue, "admin setting"), sessionId, new Date().toISOString()).run();
  const settings = await listAdminSettings(database);
  const setting = settings.find((candidate) => candidate.key === key);
  if (!setting) throw new ValidationError("admin setting was not persisted");
  return setting;
}

export async function resetAdminSetting(
  database: DatabaseClient,
  key: string,
  _sessionId: string,
): Promise<AdminSettingRecord> {
  if (!isSettingKey(key)) throw new ValidationError("unknown admin setting");
  await database.prepare("DELETE FROM admin_settings WHERE key = ?").bind(key).run();
  const settings = await listAdminSettings(database);
  const setting = settings.find((candidate) => candidate.key === key);
  if (!setting) throw new ValidationError("admin setting reset was not persisted");
  return setting;
}
