import type {
  ExecutionContext,
  ExportedHandler,
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";

import { routeApi } from "./api/router";
import { consumeAgentJobs, type AgentJobMessage } from "./jobs";

function logScheduleTick(controller: ScheduledController): void {
  console.log(
    JSON.stringify({
      event: "foundation_schedule_tick",
      cron: controller.cron,
      phase: "00-foundation",
    }),
  );
}

const handler = {
  async fetch(request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return routeApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(
    controller: ScheduledController,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    logScheduleTick(controller);
  },

  async queue(
    batch: MessageBatch<AgentJobMessage>,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    consumeAgentJobs(batch);
  },
} satisfies ExportedHandler<Env, AgentJobMessage>;

export default handler;
