import type {
  ExecutionContext,
  ExportedHandler,
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";

import { createAgentScheduler } from "./agents/factory";
import { routeApi } from "./api/router";
import { consumeAgentJobs, type AgentJobMessage } from "./jobs";
import { handleTelegramWebhook } from "./telegram/webhook";

function logScheduleTick(controller: ScheduledController): void {
  console.log(
    JSON.stringify({
      event: "foundation_schedule_tick",
      cron: controller.cron,
      phase: "03-agent-runtime",
    }),
  );
}

const handler = {
  async fetch(request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/telegram/webhook/")) {
      return handleTelegramWebhook(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return routeApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    logScheduleTick(controller);
    try {
      const result = await createAgentScheduler(env).tick();
      console.log(JSON.stringify({
        event: "agent_scheduler_tick_completed",
        dueSchedule: result.dueSchedule,
        ambientJobsCreated: result.ambientJobsCreated,
        dueJobsEnqueued: result.dueJobsEnqueued,
        inactivityRecovery: result.inactivityRecovery,
      }));
    } catch {
      console.warn(JSON.stringify({ event: "agent_scheduler_tick_failed" }));
    }
  },

  async queue(
    batch: MessageBatch<AgentJobMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await consumeAgentJobs(batch, env);
  },
} satisfies ExportedHandler<Env, AgentJobMessage>;

export default handler;
