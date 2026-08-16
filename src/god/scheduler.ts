import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import type { AgentJobMessage } from "../jobs";

type GodRepositories = ReturnType<typeof createRepositories>;

export interface GodSchedulerDependencies {
  readonly repositories: GodRepositories;
  readonly queue: { send(message: AgentJobMessage): Promise<unknown> };
  readonly enabled: boolean;
  readonly now?: () => string;
}

export interface GodSchedulerTickResult {
  readonly due: boolean;
  readonly jobsCreated: number;
  readonly enabled: boolean;
}

const SCHEDULE_KEY = "god-review-12-hour";
const REVIEW_INTERVAL_MS = 12 * 60 * 60 * 1000;

function plusInterval(timestamp: string): string {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new Error("GOD schedule timestamp must be valid");
  return new Date(value + REVIEW_INTERVAL_MS).toISOString();
}

export class GodScheduler {
  private readonly now: () => string;

  constructor(private readonly dependencies: GodSchedulerDependencies) {
    this.now = dependencies.now ?? nowIso;
  }

  async tick(): Promise<GodSchedulerTickResult> {
    const asOf = this.now();
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

    const slot = Math.floor(Date.parse(asOf) / REVIEW_INTERVAL_MS);
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
    await this.dependencies.repositories.reputation.markScheduleEnqueued(SCHEDULE_KEY, plusInterval(asOf), undefined, asOf);
    return { due: true, jobsCreated: 1, enabled: true };
  }
}

export { SCHEDULE_KEY as GOD_SCHEDULE_KEY };
