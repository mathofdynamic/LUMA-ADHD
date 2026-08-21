import type { createRepositories } from "../database/repositories";
import { ValidationError } from "../database/errors";
import type { LLMProvider, LLMReasoningEffort } from "../llm";
import { ThreadSummaryRepository } from "./repositories";

type Repositories = ReturnType<typeof createRepositories>;

function fallbackSummary(input: {
  readonly objective: string;
  readonly messages: readonly { readonly authorType: string; readonly contentText: string }[];
}): string {
  const evidence = input.messages.slice(-8).map((message) => `- ${message.authorType}: ${message.contentText.slice(0, 420)}`).join("\n");
  return [
    `## Objective\n${input.objective.slice(0, 600)}`,
    "## Recent facts and proposals",
    evidence || "- No recent messages are available.",
    "## Unresolved questions\n- Reassess the next useful evidence before making a durable decision.",
    "## Next direction\n- Continue from the most recent concrete question.",
  ].join("\n\n").slice(0, 4_500);
}

function readSummary(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const summary = (parsed as { summary_markdown?: unknown }).summary_markdown;
      if (typeof summary === "string" && summary.trim()) return summary.trim().slice(0, 4_500);
    }
  } catch {
    // The bounded fallback below treats plain text as a provider summary.
  }
  const plain = text.trim();
  return plain.length > 0 && !plain.includes("chain-of-thought") ? plain.slice(0, 4_500) : null;
}

export interface ThreadSummaryServiceOptions {
  readonly provider?: LLMProvider;
  readonly modelKey?: string;
  readonly reasoningEffort?: LLMReasoningEffort;
  readonly minimumNewMessages?: number;
}

export class ThreadSummaryService {
  private readonly summaries: ThreadSummaryRepository;
  private readonly minimumNewMessages: number;

  constructor(private readonly repositories: Repositories, private readonly options: ThreadSummaryServiceOptions = {}) {
    this.summaries = repositories.threadSummaries;
    this.minimumNewMessages = Math.max(2, Math.min(options.minimumNewMessages ?? 8, 30));
  }

  async maybeCompact(input: {
    readonly threadId: string;
    readonly phaseKey?: string;
    readonly force?: boolean;
  }) {
    const thread = await this.repositories.threads.getById(input.threadId);
    const messageCount = await this.repositories.messages.countByThread(input.threadId);
    const current = await this.summaries.get(input.threadId, input.phaseKey ?? "overall");
    if (!input.force && current && messageCount - current.messageCount < this.minimumNewMessages) return null;
    const recentMessages = await this.repositories.messages.listRecentByThread(input.threadId, 20);
    const objective = thread.summary ?? thread.title;
    let summaryMarkdown: string | null = null;
    let providerName: string | undefined;
    let modelName: string | undefined;
    if (this.options.provider) {
      try {
        const response = await this.options.provider.generate({
          modelKey: this.options.modelKey ?? "auto",
          systemPrompt: [
            "Create a compact institutional memory summary for one LUMA ADHD thread.",
            "Return only JSON with one field: summary_markdown.",
            "Include objective, important facts, major proposals, disagreements, decisions, unresolved questions, and next direction when present.",
            "Preserve uncertainty. Do not include hidden reasoning or chain-of-thought.",
          ].join("\n"),
          messages: [{
            role: "user",
            content: JSON.stringify({ objective, threadState: thread.state, recentMessages }),
          }],
          temperature: 0,
          maxOutputTokens: 700,
          reasoningEffort: this.options.reasoningEffort,
          timeoutMs: 28_000,
          metadata: { purpose: "thread_summary", threadId: input.threadId },
        });
        summaryMarkdown = readSummary(response.text);
        providerName = response.provider;
        modelName = response.model;
        await this.repositories.providerUsage.create({
          providerName: response.provider, modelName: response.model, status: "completed", requestId: response.requestId,
          promptTokens: response.usage?.promptTokens, completionTokens: response.usage?.completionTokens,
          totalTokens: response.usage?.totalTokens, durationMs: response.latencyMs,
          idempotencyKey: `summary-provider:${input.threadId}:${messageCount}`,
          metadata: {
            purpose: "thread_summary",
            ...(response.metadata ?? {}),
            ...(response.usage?.reasoningTokens === undefined ? {} : { reasoningTokens: String(response.usage.reasoningTokens) }),
          },
        });
      } catch {
        summaryMarkdown = null;
      }
    }
    const summary = summaryMarkdown ?? fallbackSummary({ objective, messages: recentMessages });
    if (!summary) throw new ValidationError("thread summary was empty");
    const record = await this.summaries.upsert({
      threadId: input.threadId,
      phaseKey: input.phaseKey,
      summaryMarkdown: summary,
      messageCount,
      lastMessageId: recentMessages.at(-1)?.id,
      providerName,
      modelName,
      idempotencyKey: `thread-summary:${input.threadId}:${input.phaseKey ?? "overall"}:${messageCount}`,
      metadata: { trigger: input.force ? "forced" : "message_threshold", source: "phase-04" },
    });
    await this.repositories.events.append({
      eventType: "summary_compacted", aggregateType: "thread_summary", aggregateId: record.id,
      threadId: input.threadId, idempotencyKey: `summary-compacted:${input.threadId}:${input.phaseKey ?? "overall"}:${messageCount}`,
      payload: { messageCount, version: record.currentVersion, provider: providerName ?? "fallback" },
    });
    return record;
  }
}
