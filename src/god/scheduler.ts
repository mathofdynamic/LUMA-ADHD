import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import type { AgentJobMessage } from "../jobs";
import { DEFAULT_RUNTIME_SETTINGS, loadEffectiveRuntimeSettings, type EffectiveRuntimeSettings } from "../admin/settings";
import { countDailyAutonomyJobs } from "../autonomy-budgets";

type GodRepositories = ReturnType<typeof createRepositories>;

export interface GodSchedulerDependencies {
  readonly repositories: GodRepositories;
  readonly queue: { send(message: AgentJobMessage): Promise<unknown> };
  readonly enabled: boolean;
  readonly runtimeSettings?: EffectiveRuntimeSettings;
  readonly now?: () => string;
}

export interface GodSchedulerTickResult {
  readonly due: boolean;
  readonly jobsCreated: number;
  readonly enabled: boolean;
}

const SCHEDULE_KEY = "god-review-12-hour";
function plusInterval(timestamp: string, intervalMs: number): string {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new Error("GOD schedule timestamp must be valid");
  return new Date(value + intervalMs).toISOString();
}

export class GodScheduler {
  private readonly now: () => string;
  private readonly runtimeSettings: Promise<EffectiveRuntimeSettings>;

  constructor(private readonly dependencies: GodSchedulerDependencies) {
    this.now = dependencies.now ?? nowIso;
    this.runtimeSettings = dependencies.runtimeSettings
      ? Promise.resolve(dependencies.runtimeSettings)
      : loadEffectiveRuntimeSettings(dependencies.repositories.database).catch(() => DEFAULT_RUNTIME_SETTINGS);
  }

  async tick(): Promise<GodSchedulerTickResult> {
    const asOf = this.now();
    const settings = await this.runtimeSettings;
    const reviewIntervalMs = settings.godReviewCadenceHours * 60 * 60 * 1000;
    let schedule = await this.dependencies.repositories.reputation.getSchedule(SCHEDULE_KEY);
    if (!schedule) {
      schedule = await this.dependencies.repositories.reputation.upsertSchedule({
        scheduleKey: SCHEDULE_KEY,
        nextDueAt: asOf,
        idempotencyKey: `god-schedule:${SCHEDULE_KEY}`,
      });
    }
    if (!this.dependencies.enabled || schedule.nextDueAt > asOf) {
      return { due: false, jobsCreated: 0, enabled: this.dependencies.enabled };
    }

    const dailyReviews = await countDailyAutonomyJobs(this.dependencies.repositories.database, "god", asOf);
    if (dailyReviews >= settings.godDailyReviewBudget) {
      await this.dependencies.repositories.reputation.markScheduleEnqueued(
        SCHEDULE_KEY,
        plusInterval(asOf, reviewIntervalMs),
        undefined,
        asOf,
      );
      await this.dependencies.repositories.events.append({
        eventType: "scheduler.autonomy_budget_exhausted",
        aggregateType: "scheduler",
        aggregateId: SCHEDULE_KEY,
        idempotencyKey: `scheduler-budget:${SCHEDULE_KEY}:${asOf.slice(0, 10)}`,
        payload: { budget: "god", used: dailyReviews, limit: settings.godDailyReviewBudget },
      });
      return { due: true, jobsCreated: 0, enabled: true };
    }

    const slot = Math.floor(Date.parse(asOf) / reviewIntervalMs);
    const job = await this.dependencies.repositories.jobs.create({
      jobType: "god.review",
      payload: { source: "scheduler", trigger: "12_hour_review", publishTelegram: false },
      idempotencyKey: `god-review-job:${slot}`,
      dueAt: asOf,
      priority: 30,
      maxAttempts: 1,
    });
    if (job.lastEnqueuedAt === null) {
      await this.dependencies.queue.send({ kind: "agent.job", jobId: job.id, depth: job.chainDepth, createdAt: asOf });
      await this.dependencies.repositories.jobs.markEnqueued(job.id, asOf);
    }
    await this.dependencies.repositories.reputation.markScheduleEnqueued(SCHEDULE_KEY, plusInterval(asOf, reviewIntervalMs), undefined, asOf);
    return { due: true, jobsCreated: 1, enabled: true };
  }
}

export { SCHEDULE_KEY as GOD_SCHEDULE_KEY };
