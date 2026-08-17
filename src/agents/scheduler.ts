import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import type { AgentJobMessage } from "../jobs";
import type { JobRecord } from "../database/types";
import { DEFAULT_RUNTIME_SETTINGS, loadEffectiveRuntimeSettings, type EffectiveRuntimeSettings } from "../admin/settings";
import { countDailyAutonomyJobs } from "../autonomy-budgets";
import { selectNextAgent, type AgentCandidateProfile } from "./selection";

type SchedulerRepositories = ReturnType<typeof createRepositories>;

export interface AgentJobQueue {
  send(message: AgentJobMessage): Promise<unknown>;
}

export interface AgentSchedulerDependencies {
  readonly repositories: SchedulerRepositories;
  readonly queue: AgentJobQueue;
  readonly runtimeSettings?: EffectiveRuntimeSettings;
  readonly now?: () => string;
  readonly rng?: () => number;
}

export interface SchedulerTickResult {
  readonly dueSchedule: boolean;
  readonly ambientJobsCreated: number;
  readonly dueJobsEnqueued: number;
  readonly inactivityRecovery: boolean;
  readonly budgetExhausted: boolean;
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
  private readonly runtimeSettings: Promise<EffectiveRuntimeSettings>;

  constructor(private readonly dependencies: AgentSchedulerDependencies) {
    this.now = dependencies.now ?? nowIso;
    this.rng = dependencies.rng ?? Math.random;
    this.runtimeSettings = dependencies.runtimeSettings
      ? Promise.resolve(dependencies.runtimeSettings)
      : loadEffectiveRuntimeSettings(dependencies.repositories.database).catch(() => DEFAULT_RUNTIME_SETTINGS);
  }

  async tick(): Promise<SchedulerTickResult> {
    const asOf = this.now();
    const settings = await this.runtimeSettings;
    const enqueued = await this.enqueueDueJobs(asOf, settings.schedulerWorkPerTick);
    let schedule = await this.dependencies.repositories.scheduledJobs.getByKey(SCHEDULE_KEY).catch(() => null);
    if (!schedule) {
      schedule = await this.dependencies.repositories.scheduledJobs.upsert({
        scheduleKey: SCHEDULE_KEY,
        jobType: "scheduler.ambient_tick",
        scheduleExpression: SCHEDULE_EXPRESSION,
        payload: { source: "cron", intervalMinutes: settings.ambientOpportunityIntervalMinutes },
        nextRunAt: asOf,
      });
    }
    if (schedule.nextRunAt > asOf) {
      return {
        dueSchedule: false,
        ambientJobsCreated: 0,
        dueJobsEnqueued: enqueued,
        inactivityRecovery: false,
        budgetExhausted: false,
      };
    }

    const dailyAmbientJobs = await countDailyAutonomyJobs(this.dependencies.repositories.database, "ambient", asOf);
    const availableAmbientJobs = Math.max(0, settings.ambientDailyJobBudget - dailyAmbientJobs);
    const budgetExhausted = availableAmbientJobs === 0;
    const threads = await this.dependencies.repositories.threads.listActive(50);
    const profiles = await this.loadProfiles();
    const candidates = threads
      .map((thread) => ({ thread, inactiveHours: hoursSince(asOf, thread.lastActivityAt) }))
      .filter(({ inactiveHours }) => inactiveHours >= settings.ambientOpportunityIntervalMinutes / 60)
      .sort((left, right) => right.inactiveHours - left.inactiveHours || right.thread.priority - left.thread.priority)
      .slice(0, Math.min(settings.schedulerWorkPerTick, availableAmbientJobs));
    const slot = Math.floor(Date.parse(asOf) / (settings.ambientOpportunityIntervalMinutes * 60_000));
    let ambientJobsCreated = 0;
    let inactivityRecovery = false;
    for (const candidate of candidates) {
      const recovery = candidate.inactiveHours >= settings.inactivityRecoveryHours;
      inactivityRecovery ||= recovery;
      const activityRows = await this.dependencies.repositories.agentTurns.getSelectionActivity(
        profiles.map((profile) => profile.agent.id),
        candidate.thread.id,
        asOf,
        72,
      );
      const preferred = selectNextAgent({
        profiles,
        messageText: [candidate.thread.title, candidate.thread.summary ?? ""].join(" "),
        thread: candidate.thread,
        activityByAgentId: Object.fromEntries(Object.entries(activityRows).map(([agentId, row]) => [agentId, {
          lastTurnAt: row.last_turn_at,
          lastThreadTurnAt: row.last_thread_turn_at,
          lastAmbientOpportunityAt: row.last_ambient_opportunity_at,
          recentOpportunityCount: row.recent_opportunity_count,
          recentMeaningfulContributionCount: row.recent_meaningful_count,
          recentThreadOpportunityCount: row.recent_thread_opportunity_count,
          recentThreadMeaningfulContributionCount: row.recent_thread_meaningful_count,
        }])),
        reputationByAgentId: Object.fromEntries(profiles.map((profile) => [profile.agent.id, (profile.agent.rank - 10) / 10])),
        turnIndex: 0,
        now: asOf,
        explorationRate: 0,
        rng: this.rng,
      });
      const job = await this.dependencies.repositories.jobs.create({
        jobType: "agent.ambient",
        payload: {
          source: "scheduler",
          threadId: candidate.thread.id,
          wakeReason: recovery ? "inactivity_recovery" : "quiet_active_thread",
          preferredAgentId: preferred?.agentId ?? null,
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
      asOfPlusMinutes(asOf, settings.ambientOpportunityIntervalMinutes + jitterMinutes),
      asOf,
    );

    if (budgetExhausted) {
      await this.dependencies.repositories.events.append({
        eventType: "scheduler.autonomy_budget_exhausted",
        aggregateType: "scheduler",
        aggregateId: SCHEDULE_KEY,
        idempotencyKey: `scheduler-budget:${SCHEDULE_KEY}:${asOf.slice(0, 10)}`,
        payload: { budget: "ambient", used: dailyAmbientJobs, limit: settings.ambientDailyJobBudget },
      });
    }

    return {
      dueSchedule: true,
      ambientJobsCreated,
      dueJobsEnqueued: enqueued,
      inactivityRecovery,
      budgetExhausted,
    };
  }

  async enqueueDueJobs(asOf = this.now(), limit?: number): Promise<number> {
    const effectiveLimit = limit ?? (await this.runtimeSettings).schedulerWorkPerTick;
    const jobs = await this.dependencies.repositories.jobs.listDueToEnqueue(asOf, effectiveLimit);
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
    preferredAgentId?: string | null,
  ): Promise<string> {
    const slot = `${Date.parse(asOf)}-${threadId}`;
    const job = await this.dependencies.repositories.jobs.create({
      jobType: "agent.ambient",
      payload: { source: "operator", threadId, wakeReason, preferredAgentId: preferredAgentId ?? null },
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

  private async loadProfiles(): Promise<readonly AgentCandidateProfile[]> {
    const agents = (await this.dependencies.repositories.agents.listActive(20))
      .filter((agent) => !agent.isSupervisor);
    return Promise.all(agents.map(async (agent) => ({
      agent,
      specialties: await this.dependencies.repositories.agents.listSpecialties(agent.id),
      interests: await this.dependencies.repositories.agents.listInterests(agent.id),
    })));
  }
}

export { SCHEDULE_KEY as AGENT_AMBIENT_SCHEDULE_KEY };
