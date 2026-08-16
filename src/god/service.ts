import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import { escapeTelegramHtml } from "../telegram/format";
import type { TelegramApplicationService } from "../telegram";
import { LLMProviderError, normalizeProviderError, type LLMGenerateResponse, type LLMProvider } from "../llm";
import { FOUNDATION_GUARDRAILS } from "../guardrails";
import { ReputationService } from "../reputation/service";
import { isNormalAgentId } from "../reputation/model";
import type { JsonObject } from "../database/validation";
import type {
  EvaluationRecord,
  GodDirectiveRecord,
  GodReviewResult,
  GodReviewOutput,
  ReputationEventRecord,
} from "../reputation/types";
import { GodBriefingService } from "./briefing";
import { GOD_REVIEW_OUTPUT_SCHEMA, GodReviewOutputValidationError, parseGodReviewOutput } from "./schema";

type GodRepositories = ReturnType<typeof createRepositories>;

export interface GodReviewServiceDependencies {
  readonly repositories: GodRepositories;
  readonly provider: LLMProvider;
  readonly modelKey: string;
  readonly reputation: ReputationService;
  readonly memory?: import("../memory").MemoryServices;
  readonly telegram?: Pick<TelegramApplicationService, "projectAgentMessage">;
  readonly now?: () => string;
}

function safeFailure(error: unknown): string {
  if (error instanceof LLMProviderError) {
    return JSON.stringify({ kind: error.failure.kind, retryable: error.failure.retryable, status: error.failure.status ?? null });
  }
  return JSON.stringify({ kind: "god_review", message: String(error).slice(0, 300) });
}

function outputJson(output: GodReviewOutput): JsonObject {
  return JSON.parse(JSON.stringify(output)) as JsonObject;
}

function markdownReview(output: GodReviewOutput, reviewId: string): string {
  const section = (title: string, values: readonly string[]) => values.length === 0 ? "" : `\n## ${title}\n${values.map((item) => `- ${item}`).join("\n")}\n`;
  return [
    `# GOD Review ${reviewId}`,
    `\n## Executive summary\n${output.executiveSummary}`,
    section("Important findings", output.importantFindings),
    section("Weak reasoning", output.weakReasoning),
    section("Unsupported assumptions", output.unsupportedAssumptions),
    section("High-value work", output.highValueWork),
    section("Unresolved risks", output.unresolvedRisks),
    section("Missing perspectives", output.missingPerspectives),
    section("Human required", output.humanRequired),
    normalizedDirectives(output).length === 0 ? "" : `\n## Directives\n${normalizedDirectives(output).map((directive) => `- ${directive.directive}`).join("\n")}`,
  ].filter(Boolean).join("\n").slice(0, 18_000);
}

function normalizedDirectives(output: GodReviewOutput): readonly {
  readonly targetAgentId?: GodReviewOutput["directives"][number]["targetAgentId"];
  readonly targetThreadId?: string;
  readonly directive: string;
  readonly priority?: number;
}[] {
  return [
    ...output.directives,
    ...output.threadRecommendations.map((recommendation) => ({
      targetThreadId: recommendation.threadId,
      directive: recommendation.recommendation,
      priority: 50,
    })),
  ];
}

function publicSummary(output: GodReviewOutput): string {
  const first = (values: readonly string[], fallback: string) => values[0] ?? fallback;
  const directives = normalizedDirectives(output);
  return [
    "<b>GOD | داور — مرور دوره‌ای</b>",
    "",
    `• مهم‌ترین یافته: ${escapeTelegramHtml(first(output.importantFindings, output.executiveSummary))}`,
    `• ریسک حل‌نشده: ${escapeTelegramHtml(first(output.unresolvedRisks, "ریسک مهمی در این مرور ثبت نشد."))}`,
    `• مسیر امیدوارکننده: ${escapeTelegramHtml(first(output.highValueWork, "نیاز به شواهد بیشتر داریم."))}`,
    `• اقدام پیشنهادی: ${escapeTelegramHtml(first(directives.map((item) => item.directive), "فعلاً اقدام جدیدی ایجاد نشد."))}`,
  ].join("\n");
}

export interface RunGodReviewInput {
  readonly idempotencyKey: string;
  readonly reviewPeriodStart?: string;
  readonly reviewPeriodEnd?: string;
  readonly publishTelegram?: boolean;
  readonly telegramChatId?: string;
  readonly telegramThreadId?: string;
  readonly jobId?: string;
}

export class GodReviewService {
  private readonly now: () => string;
  private readonly briefing: GodBriefingService;

  constructor(private readonly dependencies: GodReviewServiceDependencies) {
    this.now = dependencies.now ?? nowIso;
    this.briefing = new GodBriefingService({ repositories: dependencies.repositories, memory: dependencies.memory, now: this.now });
  }

  async run(input: RunGodReviewInput): Promise<GodReviewResult> {
    const briefing = await this.briefing.build();
    const review = await this.dependencies.repositories.reputation.createReview({
      threadId: undefined,
      reviewPeriodStart: input.reviewPeriodStart,
      reviewPeriodEnd: input.reviewPeriodEnd ?? this.now(),
      briefing: JSON.parse(JSON.stringify({ ...briefing, maskedContributors: undefined })) as JsonObject,
      idempotencyKey: input.idempotencyKey,
    });
    if (review.status === "completed") {
      return { review, directives: [], evaluations: [], evidence: [], publicMessageId: review.publicMessageId };
    }

    const systemPrompt = [
      "You are GOD | داور, the bounded supervisory reviewer of LUMA ADHD.",
      "Review organizational evidence, not hidden model reasoning. Preserve uncertainty and do not directly change Rank.",
      "Contributor labels are masked to reduce reputation halo bias. Use only the supplied briefing and provenance.",
      "Return exactly one JSON object matching this schema and no prose outside JSON.",
      GOD_REVIEW_OUTPUT_SCHEMA,
      "Agent evaluations are evidence proposals only. Do not invent outcomes. Use concise rationale summaries.",
    ].join("\n");
    let response: LLMGenerateResponse;
    let repairAttempts = 0;
    try {
      const started = Date.now();
      response = await this.dependencies.provider.generate({
        modelKey: this.dependencies.modelKey,
        systemPrompt,
        messages: [{ role: "user", content: GodBriefingService.toPromptText(briefing) }],
        temperature: 0,
        maxOutputTokens: 1_500,
        timeoutMs: FOUNDATION_GUARDRAILS.providerTimeoutMilliseconds,
        metadata: { role: "god", reviewId: review.id },
      });
      await this.recordUsage(`god-provider-usage:${review.id}:initial`, input.jobId, response, undefined, Date.now() - started);
    } catch (error: unknown) {
      const normalized = normalizeProviderError(error);
      await this.recordUsage(`god-provider-usage:${review.id}:initial`, input.jobId, undefined, normalized, 0);
      const failed = await this.dependencies.repositories.reputation.failReview({ id: review.id, summary: safeFailure(normalized), repairAttempts: 0, providerName: this.dependencies.provider.name, modelName: this.dependencies.modelKey });
      return { review: failed, directives: [], evaluations: [], evidence: [], publicMessageId: null };
    }

    let output: GodReviewOutput;
    try {
      output = parseGodReviewOutput(response.text);
    } catch (error: unknown) {
      if (!(error instanceof GodReviewOutputValidationError)) throw error;
      repairAttempts = 1;
      try {
        const started = Date.now();
        const repaired = await this.dependencies.provider.generate({
          modelKey: this.dependencies.modelKey,
          systemPrompt: `${systemPrompt}\nValidation errors: ${error.problems.join("; ")}\nReturn the corrected JSON once.`,
          messages: [{ role: "user", content: response.text.slice(0, 8_000) }],
          temperature: 0,
          maxOutputTokens: 1_500,
          timeoutMs: FOUNDATION_GUARDRAILS.providerTimeoutMilliseconds,
          metadata: { role: "god", reviewId: review.id, repair: "true" },
        });
        await this.recordUsage(`god-provider-usage:${review.id}:repair`, input.jobId, repaired, undefined, Date.now() - started);
        output = parseGodReviewOutput(repaired.text);
        response = repaired;
      } catch (repairError: unknown) {
        if (repairError instanceof LLMProviderError) await this.recordUsage(`god-provider-usage:${review.id}:repair`, input.jobId, undefined, repairError, 0);
        const failed = await this.dependencies.repositories.reputation.failReview({ id: review.id, summary: repairError instanceof Error ? repairError.message.slice(0, 500) : "GOD structured output validation failed", repairAttempts });
        return { review: failed, directives: [], evaluations: [], evidence: [], publicMessageId: null };
      }
    }

    try {
      for (const evaluation of output.agentEvaluations) {
        if (evaluation.sourceMessageId) await this.dependencies.repositories.messages.getById(evaluation.sourceMessageId);
      }
      for (const directive of normalizedDirectives(output)) {
        if (directive.targetThreadId) await this.dependencies.repositories.threads.getById(directive.targetThreadId);
      }
      if (this.dependencies.memory) {
        const logicalPath = `/god/reviews/${(input.reviewPeriodEnd ?? this.now()).slice(0, 10)}-${review.id}.md`;
        const existing = await this.dependencies.memory.documents.read(logicalPath, { agentId: "agent-god" }).catch(() => null);
        if (!existing) {
          await this.dependencies.memory.documents.create({
            actor: { agentId: "agent-god" }, logicalPath, title: `GOD review ${review.id}`,
            contentMarkdown: markdownReview(output, review.id), metadata: { reviewId: review.id, source: "god_review" },
          });
        }
      }
    } catch (error: unknown) {
      const failed = await this.dependencies.repositories.reputation.failReview({
        id: review.id,
        summary: `GOD review preflight failed: ${String(error).slice(0, 420)}`,
        repairAttempts,
        providerName: response.provider,
        modelName: response.model,
      });
      return { review: failed, directives: [], evaluations: [], evidence: [], publicMessageId: null };
    }

    const evaluations = [] as EvaluationRecord[];
    const evidence = [] as ReputationEventRecord[];
    for (const [index, evaluation] of output.agentEvaluations.entries()) {
      if (!isNormalAgentId(evaluation.agentId)) continue;
      const stored = await this.dependencies.reputation.recordEvaluation({
        targetAgentId: evaluation.agentId,
        evaluationType: "god",
        domain: evaluation.domain,
        dimension: evaluation.dimension,
        signal: evaluation.signal,
        messageId: evaluation.sourceMessageId,
        rationale: evaluation.rationale,
        evidenceSummary: evaluation.rationale,
        idempotencyKey: `${review.id}:evaluation:${index}`,
      });
      evaluations.push(stored.evaluation);
      evidence.push(stored.evidence);
    }
    const directives = [] as GodDirectiveRecord[];
    for (const [index, directive] of normalizedDirectives(output).entries()) {
      directives.push(await this.dependencies.repositories.reputation.createDirective({
        reviewId: review.id,
        targetAgentId: directive.targetAgentId,
        targetThreadId: directive.targetThreadId,
        directive: directive.directive,
        priority: directive.priority,
        sourceSummary: output.executiveSummary,
        idempotencyKey: `${review.id}:directive:${index}`,
      }));
    }

    let publicMessageId: string | undefined;
    if (input.publishTelegram && input.telegramChatId && this.dependencies.telegram && output.publicSummary !== undefined) {
      try {
        const projected = await this.dependencies.telegram.projectAgentMessage({
          threadId: input.telegramThreadId ?? "",
          chatId: input.telegramChatId,
          agentId: "agent-god",
          transportBotAlias: "gateway",
          contentText: publicSummary(output),
          contentFormat: "telegram_html",
          idempotencyKey: `${review.id}:public-summary`,
          metadata: { source: "god_review", godReviewId: review.id },
        });
        publicMessageId = projected.messageId;
      } catch (error: unknown) {
        await this.dependencies.repositories.events.append({
          eventType: "god.public_projection_failed",
          aggregateType: "god_review",
          aggregateId: review.id,
          idempotencyKey: `god-public-projection-failed:${review.id}`,
          payload: { error: String(error).slice(0, 300) },
        });
      }
    }

    const completed = await this.dependencies.repositories.reputation.completeReview({
      id: review.id,
      summary: output.executiveSummary,
      findings: outputJson(output),
      providerName: response.provider,
      modelName: response.model,
      repairAttempts,
      publicMessageId,
    });
    return { review: completed, directives, evaluations, evidence, publicMessageId: publicMessageId ?? null };
  }

  private async recordUsage(
    key: string,
    jobId: string | undefined,
    response: LLMGenerateResponse | undefined,
    failure: LLMProviderError | undefined,
    durationMs: number,
  ): Promise<void> {
    await this.dependencies.repositories.providerUsage.create({
      providerName: response?.provider ?? this.dependencies.provider.name,
      modelName: response?.model ?? this.dependencies.modelKey,
      jobId,
      status: failure?.failure.kind === "timeout" ? "timed_out" : failure ? "failed" : "completed",
      requestId: response?.requestId,
      promptTokens: response?.usage?.promptTokens,
      completionTokens: response?.usage?.completionTokens,
      totalTokens: response?.usage?.totalTokens,
      durationMs,
      errorSummary: failure ? safeFailure(failure) : undefined,
      idempotencyKey: key,
      metadata: { role: "god" },
    });
  }
}
