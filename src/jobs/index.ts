import type { MessageBatch } from "@cloudflare/workers-types";

export interface AgentJobMessage {
  readonly kind: "foundation.noop";
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
    candidate.kind === "foundation.noop" &&
    typeof candidate.jobId === "string" &&
    typeof candidate.depth === "number" &&
    typeof candidate.createdAt === "string"
  );
}

/** Phase 01 keeps the Queue contract coarse without executing agent work. */
export function consumeAgentJobs(
  batch: MessageBatch<AgentJobMessage>,
): void {
  for (const message of batch.messages) {
    if (!isAgentJobMessage(message.body)) {
      console.warn(JSON.stringify({ event: "foundation_queue_invalid_message" }));
      message.ack();
      continue;
    }

    console.log(
      JSON.stringify({
        event: "foundation_queue_message_ack",
        jobId: message.body.jobId,
        depth: message.body.depth,
      }),
    );
    message.ack();
  }
}
