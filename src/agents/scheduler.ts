import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import { FOUNDATION_GUARDRAILS } from "../guardrails";
import type { AgentJobMessage } from "../jobs";
import type { JobRecord } from "../database/types";

type SchedulerRepositories = ReturnType<typeof createRepositories>;

export interface AgentJobQueue {
  send(message: AgentJobMessage): Promise<unknown>;
}

export interface AgentSchedulerDependencies {
  readonly repositories: SchedulerRepositories;
  readonly queue: AgentJobQueue;
  readonly now?: () => string;
  readonly rng?: () => number;
}

export interface SchedulerTickResult {
  readonly dueSchedule: boolean;
  readonly ambientJobsCreated: number;
  readonly dueJobsEnqueued: number;
  readonly inactivityRecovery: boolean;
}

const SCHEDULE_KEY = "agent-runtime-ambient-opportunities";
const SCHEDULE_EXPRESSION = "every-4-hours-with-jitter";

function asOfPlusMinutes(asOf: string, minutes: number): string {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) throw new Error("scheduler timestamp must be valid ISO");
  return new Date(timestamp + minutes * 60_000).toISOString();
}

function hoursSince(asOf: string, earlier: string): number {
  const difference = Date.parse(asOf) - Date.parse(earlier);
  return Number.isFinite(difference) ? difference / 3_600_000 : 0;
}

export class AgentScheduler {
  private readonly now: () => string;
  private readonly rng: () => number;

  constructor(private readonly dependencies: AgentSchedulerDependencies) {
    this.now = dependencies.now ?? nowIso;
    this.rng = dependencies.rng ?? Math.random;
  }

  async tick(): Promise<SchedulerTickResult> {
    const asOf = this.now();
    const enqueued = await this.enqueueDueJobs(asOf);
    let schedule = await this.dependencies.repositories.scheduledJobs.getByKey(SCHEDULE_KEY).catch(() => null);
    if (!schedule) {
      schedule = await this.dependencies.repositories.scheduledJobs.upsert({
        scheduleKey: SCHEDULE_KEY,
        jobType: "scheduler.ambient_tick",
        scheduleExpression: SCHEDULE_EXPRESSION,
        payload: { source: "cron", intervalMinutes: FOUNDATION_GUARDRAILS.ambientOpportunityIntervalMinutes },
        nextRunAt: asOf,
      });
    }
    if (schedule.nextRunAt > asOf) {
      return {
        dueSchedule: false,
        ambientJobsCreated: 0,
        dueJobsEnqueued: enqueued,
        inactivityRecovery: false,
      };
    }

    const threads = await this.dependencies.repositories.threads.listActive(50);
    const candidates = threads
      .map((thread) => ({ thread, inactiveHours: hoursSince(asOf, thread.lastActivityAt) }))
      .filter(({ inactiveHours }) => inactiveHours >= FOUNDATION_GUARDRAILS.ambientOpportunityIntervalMinutes / 60)
      .sort((left, right) => right.inactiveHours - left.inactiveHours || right.thread.priority - left.thread.priority)
      .slice(0, FOUNDATION_GUARDRAILS.schedulerWorkPerTick);
    const slot = Math.floor(Date.parse(asOf) / (FOUNDATION_GUARDRAILS.ambientOpportunityIntervalMinutes * 60_000));
    let ambientJobsCreated = 0;
    let inactivityRecovery = false;
    for (const candidate of candidates) {
      const recovery = candidate.inactiveHours >= FOUNDATION_GUARDRAILS.inactivityRecoveryHours;
      inactivityRecovery ||= recovery;
      const job = await this.dependencies.repositories.jobs.create({
        jobType: "agent.ambient",
        payload: {
          source: "scheduler",
          threadId: candidate.thread.id,
          wakeReason: recovery ? "inactivity_recovery" : "quiet_active_thread",
        },
        idempotencyKey: `agent-ambient:${slot}:${candidate.thread.id}`,
        dueAt: asOf,
        priority: recovery ? 65 : 35,
        maxAttempts: 2,
      });
      if (job.lastEnqueuedAt === null) {
        await this.enqueueJob(job, asOf);
        ambientJobsCreated += 1;
      }
    }

    const jitterMinutes = Math.floor(Math.max(0, Math.min(1, this.rng())) * 30);
    await this.dependencies.repositories.scheduledJobs.markEnqueued(
      SCHEDULE_KEY,
      asOfPlusMinutes(asOf, FOUNDATION_GUARDRAILS.ambientOpportunityIntervalMinutes + jitterMinutes),
      asOf,
    );

    return {
      dueSchedule: true,
      ambientJobsCreated,
      dueJobsEnqueued: enqueued,
      inactivityRecovery,
    };
  }

  async enqueueDueJobs(asOf = this.now(), limit = FOUNDATION_GUARDRAILS.schedulerWorkPerTick): Promise<number> {
    const jobs = await this.dependencies.repositories.jobs.listDueToEnqueue(asOf, limit);
    let count = 0;
    for (const job of jobs) {
      await this.enqueueJob(job, asOf);
      count += 1;
    }
    return count;
  }

  async createImmediateAmbientJob(
    threadId: string,
    wakeReason = "operator_ambient_smoke",
    asOf = this.now(),
  ): Promise<string> {
    const slot = `${Date.parse(asOf)}-${threadId}`;
    const job = await this.dependencies.repositories.jobs.create({
      jobType: "agent.ambient",
      payload: { source: "operator", threadId, wakeReason },
      idempotencyKey: `agent-ambient-operator:${slot}`,
      dueAt: asOf,
      priority: 80,
      maxAttempts: 2,
    });
    await this.enqueueJob(job, asOf);
    return job.id;
  }

  private async enqueueJob(job: JobRecord, asOf: string): Promise<void> {
    await this.dependencies.queue.send({
      kind: "agent.job",
      jobId: job.id,
      depth: job.chainDepth,
      createdAt: asOf,
    });
    await this.dependencies.repositories.jobs.markEnqueued(job.id, asOf).catch(() => undefined);
  }
}

export { SCHEDULE_KEY as AGENT_AMBIENT_SCHEDULE_KEY };
