import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import type { AgentJobMessage } from "../jobs";

type ReputationRepositories = ReturnType<typeof createRepositories>;

export interface ReputationSchedulerDependencies {
  readonly repositories: ReputationRepositories;
  readonly queue: { send(message: AgentJobMessage): Promise<unknown> };
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

  constructor(private readonly dependencies: ReputationSchedulerDependencies) {
    this.now = dependencies.now ?? nowIso;
  }

  async tick(): Promise<ReputationSchedulerTickResult> {
    const asOf = this.now();
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
    await this.dependencies.repositories.scheduledJobs.markEnqueued(SCHEDULE_KEY, nextUtcDay(asOf), asOf);
    return { due: true, jobsCreated: 1 };
  }
}

export { SCHEDULE_KEY as REPUTATION_SCHEDULE_KEY };
