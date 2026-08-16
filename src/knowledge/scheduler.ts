import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import type { AgentJobQueue } from "../agents/scheduler";
import { OFFICIAL_LUMA_SOURCES } from "./sources";
import { DEFAULT_RUNTIME_SETTINGS, loadEffectiveRuntimeSettings, type EffectiveRuntimeSettings } from "../admin/settings";

type Repositories = ReturnType<typeof createRepositories>;

function plusMinutes(timestamp: string, minutes: number): string {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new Error("knowledge scheduler timestamp must be valid ISO");
  return new Date(value + minutes * 60_000).toISOString();
}

export interface KnowledgeSchedulerResult {
  readonly sourcesInitialized: number;
  readonly jobsCreated: number;
}

export class KnowledgeScheduler {
  constructor(
    private readonly repositories: Repositories,
    private readonly queue: AgentJobQueue,
    private readonly now: () => string = nowIso,
    private readonly configuredSettings?: EffectiveRuntimeSettings,
  ) {}

  async tick(): Promise<KnowledgeSchedulerResult> {
    await this.repositories.knowledgeSources.ensureOfficialSources(OFFICIAL_LUMA_SOURCES);
    const asOf = this.now();
    const settings = this.configuredSettings
      ?? await loadEffectiveRuntimeSettings(this.repositories.database).catch(() => DEFAULT_RUNTIME_SETTINGS);
    const due = await this.repositories.knowledgeSources.listDue(asOf, Math.min(1, settings.schedulerWorkPerTick));
    let jobsCreated = 0;
    const slot = Math.floor(Date.parse(asOf) / (15 * 60_000));
    for (const source of due) {
      const sourceKey = source.canonicalKey.replace(/^official:/u, "");
      const job = await this.repositories.jobs.create({
        jobType: "knowledge.sync_source",
        payload: { sourceKey, sourceId: source.id, source: "scheduler" },
        idempotencyKey: `knowledge-sync:${source.id}:${slot}`,
        dueAt: asOf,
        priority: 30,
        maxAttempts: 2,
      });
      if (job.lastEnqueuedAt === null) {
        await this.queue.send({ kind: "agent.job", jobId: job.id, depth: job.chainDepth, createdAt: asOf });
        await this.repositories.jobs.markEnqueued(job.id, asOf);
        await this.repositories.knowledgeSources.updateSyncState({
          sourceId: source.id, status: "stale", attemptedAt: asOf,
          nextRefreshAt: plusMinutes(asOf, settings.knowledgeSyncCadenceHours * 60), errorSummary: null,
        });
        jobsCreated += 1;
      }
    }
    return { sourcesInitialized: (await this.repositories.knowledgeSources.listAll(100)).length, jobsCreated };
  }
}
