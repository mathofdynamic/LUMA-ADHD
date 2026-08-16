import type { MessageBatch } from "@cloudflare/workers-types";
import { createAgentRuntime, type AgentRuntimeEnvironment } from "../agents/factory";
import { FOUNDATION_GUARDRAILS } from "../guardrails";
import { RuntimeProviderFailure } from "../agents/runtime";
import { createMemoryServices } from "../memory";

export interface AgentJobMessage {
  readonly kind: "agent.job" | "foundation.noop";
  readonly jobId: string;
  readonly depth: number;
  readonly createdAt: string;
}

export function isAgentJobMessage(value: unknown): value is AgentJobMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "agent.job" || candidate.kind === "foundation.noop") &&
    typeof candidate.jobId === "string" &&
    typeof candidate.depth === "number" &&
    Number.isInteger(candidate.depth) &&
    candidate.depth >= 0 &&
    typeof candidate.createdAt === "string"
  );
}

function retryAt(asOf: string, attemptCount: number): string {
  const timestamp = Date.parse(asOf);
  const delaySeconds = Math.min(300, 15 * (2 ** Math.max(0, attemptCount - 1)));
  return new Date(timestamp + delaySeconds * 1000).toISOString();
}

function errorSummary(error: unknown): string {
  if (error instanceof RuntimeProviderFailure) {
    return "bounded provider failure";
  }
  return "agent runtime execution failure";
}

export async function consumeAgentJobs(
  batch: MessageBatch<AgentJobMessage>,
  env: AgentRuntimeEnvironment,
): Promise<void> {
  const runtime = createAgentRuntime(env);
  const repositories = runtime.repositories;
  const memory = createMemoryServices(repositories);

  for (const message of batch.messages) {
    if (!isAgentJobMessage(message.body)) {
      console.warn(JSON.stringify({ event: "agent_queue_invalid_message" }));
      message.ack();
      continue;
    }
    if (message.body.kind === "foundation.noop" || message.body.depth > FOUNDATION_GUARDRAILS.queueChainMaxDepth) {
      message.ack();
      continue;
    }

    const job = await repositories.jobs.getById(message.body.jobId).catch(() => null);
    if (!job) {
      message.ack();
      continue;
    }
    const leaseOwner = `queue:${crypto.randomUUID()}`;
    const claimed = await repositories.jobs.claim(job.id, leaseOwner, 90);
    if (!claimed) {
      message.ack();
      continue;
    }

    try {
      if (claimed.jobType === "knowledge.sync_source") {
        await memory.knowledge.processJob(claimed);
      } else {
        await runtime.processJob(claimed);
      }
      await repositories.jobs.complete(claimed.id, leaseOwner);
    } catch (error: unknown) {
      await repositories.jobs.fail(
        claimed.id,
        leaseOwner,
        errorSummary(error),
        error instanceof RuntimeProviderFailure,
        retryAt(new Date().toISOString(), claimed.attemptCount),
      );
      console.warn(JSON.stringify({
        event: "agent_job_failed",
        jobId: claimed.id,
        retryable: error instanceof RuntimeProviderFailure,
      }));
    }
    message.ack();
  }
}
