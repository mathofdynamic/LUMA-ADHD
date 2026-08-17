import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import type { AgentJobMessage } from "../jobs";
import { DEFAULT_RUNTIME_SETTINGS, loadEffectiveRuntimeSettings, type EffectiveRuntimeSettings } from "../admin/settings";
import { countDailyAutonomyJobs } from "../autonomy-budgets";

type ReputationRepositories = ReturnType<typeof createRepositories>;

export interface ReputationSchedulerDependencies {
  readonly repositories: ReputationRepositories;
  readonly queue: { send(message: AgentJobMessage): Promise<unknown> };
  readonly runtimeSettings?: EffectiveRuntimeSettings;
  readonly now?: () => string;
}

export interface ReputationSchedulerTickResult {
  readonly due: boolean;
  readonly jobsCreated: number;
}

const SCHEDULE_KEY = "reputation-daily-scoring";

function nextUtcDay(asOf: string): string {
  const date = new Date(asOf);
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(0, 5, 0, 0);
  return date.toISOString();
}

export class ReputationScheduler {
  private readonly now: () => string;
  private readonly runtimeSettings: Promise<EffectiveRuntimeSettings>;

  constructor(private readonly dependencies: ReputationSchedulerDependencies) {
    this.now = dependencies.now ?? nowIso;
    this.runtimeSettings = dependencies.runtimeSettings
      ? Promise.resolve(dependencies.runtimeSettings)
      : loadEffectiveRuntimeSettings(dependencies.repositories.database).catch(() => DEFAULT_RUNTIME_SETTINGS);
  }

  async tick(): Promise<ReputationSchedulerTickResult> {
    const asOf = this.now();
    const settings = await this.runtimeSettings;
    let schedule = await this.dependencies.repositories.scheduledJobs.getByKey(SCHEDULE_KEY).catch(() => null);
    if (!schedule) {
      schedule = await this.dependencies.repositories.scheduledJobs.upsert({
        scheduleKey: SCHEDULE_KEY,
        jobType: "reputation.daily_score",
        scheduleExpression: "daily-at-00:05-utc",
        payload: { source: "cron" },
        nextRunAt: asOf,
      });
    }
    if (schedule.nextRunAt > asOf) return { due: false, jobsCreated: 0 };

    const scoringDay = asOf.slice(0, 10);
    const nextRunAt = settings.reputationCalculationCadenceHours === 24
      ? nextUtcDay(asOf)
      : new Date(Date.parse(asOf) + settings.reputationCalculationCadenceHours * 60 * 60 * 1000).toISOString();
    const dailyReputationJobs = await countDailyAutonomyJobs(this.dependencies.repositories.database, "reputation", asOf);
    if (dailyReputationJobs >= settings.reputationDailyJobBudget) {
      await this.dependencies.repositories.scheduledJobs.markEnqueued(SCHEDULE_KEY, nextRunAt, asOf);
      await this.dependencies.repositories.events.append({
        eventType: "scheduler.autonomy_budget_exhausted",
        aggregateType: "scheduler",
        aggregateId: SCHEDULE_KEY,
        idempotencyKey: `scheduler-budget:${SCHEDULE_KEY}:${asOf.slice(0, 10)}`,
        payload: { budget: "reputation", used: dailyReputationJobs, limit: settings.reputationDailyJobBudget },
      });
      return { due: true, jobsCreated: 0 };
    }
    const job = await this.dependencies.repositories.jobs.create({
      jobType: "reputation.daily_score",
      payload: { source: "scheduler", scoringDay },
      idempotencyKey: `reputation-daily-job:${scoringDay}`,
      dueAt: asOf,
      priority: 45,
      maxAttempts: 2,
    });
    if (job.lastEnqueuedAt === null) {
      await this.dependencies.queue.send({ kind: "agent.job", jobId: job.id, depth: job.chainDepth, createdAt: asOf });
      await this.dependencies.repositories.jobs.markEnqueued(job.id, asOf);
    }
    await this.dependencies.repositories.scheduledJobs.markEnqueued(SCHEDULE_KEY, nextRunAt, asOf);
    return { due: true, jobsCreated: 1 };
  }
}

export { SCHEDULE_KEY as REPUTATION_SCHEDULE_KEY };
