import type { D1Database } from "@cloudflare/workers-types";
import { createRepositories } from "../database/repositories";
import {
  NebulaProvider,
  OpenAIProvider,
  DEFAULT_NEBULA_MODEL,
  VERIFIED_NEBULA_BASE_URL,
  type LLMProvider,
  type LLMReasoningEffort,
} from "../llm";
import { createTelegramApplication, TelegramBotApiTransport, parseTelegramConfig } from "../telegram";
import { AgentRuntimeService, type AgentRuntimeDependencies } from "./runtime";
import { AgentScheduler, type AgentJobQueue } from "./scheduler";
import { createMemoryServices } from "../memory";
import { KnowledgeScheduler } from "../knowledge/scheduler";
import { ReputationService } from "../reputation/service";
import { GodReviewService } from "../god/service";
import { ReputationScheduler } from "../reputation/scheduler";
import { GodScheduler } from "../god/scheduler";

export interface AgentRuntimeEnvironment {
  readonly DB: D1Database;
  readonly NEBULA_API_KEY?: string;
  readonly NEBULA_BASE_URL?: string;
  readonly NEBULA_MODEL?: string;
  readonly TELEGRAM_GROUP_ID?: string;
  readonly TELEGRAM_ADMIN_USER_IDS?: string;
  readonly TELEGRAM_BOT_IDENTITIES_JSON?: string;
  readonly TELEGRAM_WEBHOOK_SECRET?: string;
  readonly TELEGRAM_GATEWAY_BOT_TOKEN?: string;
  readonly TELEGRAM_PRODUCT_BOT_TOKEN?: string;
  readonly TELEGRAM_GROWTH_BOT_TOKEN?: string;
  readonly TELEGRAM_CREATIVE_BOT_TOKEN?: string;
  readonly TELEGRAM_TECH_BOT_TOKEN?: string;
  readonly TELEGRAM_FINANCE_BOT_TOKEN?: string;
  readonly TELEGRAM_CUSTOMER_BOT_TOKEN?: string;
  readonly TELEGRAM_OPERATIONS_BOT_TOKEN?: string;
  readonly TELEGRAM_HERETIC_BOT_TOKEN?: string;
  readonly GOD_API_KEY?: string;
  readonly GOD_PROVIDER?: string;
  readonly GOD_BASE_URL?: string;
  readonly GOD_MODEL?: string;
  readonly GOD_REASONING_EFFORT?: string;
}

const GOD_REASONING_EFFORTS: readonly LLMReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

export function parseGodReasoningEffort(value: string | undefined): LLMReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase() as LLMReasoningEffort | undefined;
  return normalized !== undefined && GOD_REASONING_EFFORTS.includes(normalized) ? normalized : undefined;
}

function createConfiguredGodProvider(env: AgentRuntimeEnvironment): LLMProvider | undefined {
  if (env.GOD_PROVIDER?.trim().toLowerCase() !== "openai") return undefined;
  if (!env.GOD_API_KEY?.trim() || !env.GOD_MODEL?.trim()) return undefined;
  return new OpenAIProvider({
    apiKey: env.GOD_API_KEY,
    baseUrl: env.GOD_BASE_URL,
    model: env.GOD_MODEL,
    maxAttempts: 1,
  });
}

export function isGodProviderConfigured(env: AgentRuntimeEnvironment): boolean {
  return createConfiguredGodProvider(env) !== undefined;
}

export function createAgentRuntime(
  env: AgentRuntimeEnvironment,
  options?: { readonly provider?: LLMProvider; readonly now?: () => string; readonly rng?: () => number },
): AgentRuntimeService {
  const repositories = createRepositories(env.DB);
  const provider = options?.provider ?? new NebulaProvider({
    apiKey: env.NEBULA_API_KEY ?? "",
    baseUrl: env.NEBULA_BASE_URL || VERIFIED_NEBULA_BASE_URL,
    model: env.NEBULA_MODEL || DEFAULT_NEBULA_MODEL,
  });
  const memory = createMemoryServices(repositories, { provider, modelKey: env.NEBULA_MODEL || DEFAULT_NEBULA_MODEL });
  const reputation = new ReputationService({ repositories, now: options?.now });
  const telegramConfig = parseTelegramConfig(env);
  const telegram = createTelegramApplication({
    repositories,
    config: telegramConfig,
    transport: new TelegramBotApiTransport(telegramConfig),
    now: options?.now,
  });

  const dependencies: AgentRuntimeDependencies = {
    repositories,
    provider,
    telegram,
    modelKey: env.NEBULA_MODEL || DEFAULT_NEBULA_MODEL,
    memory,
    reputation,
    now: options?.now,
    rng: options?.rng,
  };
  return new AgentRuntimeService(dependencies);
}

/**
 * GOD is intentionally not auto-wired to Nebula. The provider protocol and
 * credential are provider-specific and must be supplied explicitly after
 * official documentation has been verified.
 */
export function createGodReviewService(
  env: AgentRuntimeEnvironment,
  options: {
    readonly provider?: LLMProvider;
    readonly now?: () => string;
  } = {},
): GodReviewService | null {
  const provider = options.provider ?? createConfiguredGodProvider(env);
  if (!provider || !env.GOD_MODEL) return null;
  const repositories = createRepositories(env.DB);
  const reputation = new ReputationService({ repositories, now: options.now });
  const memory = createMemoryServices(repositories, {
    provider: options.provider,
    modelKey: env.GOD_MODEL,
  });
  const telegramConfig = parseTelegramConfig(env);
  const telegram = createTelegramApplication({
    repositories,
    config: telegramConfig,
    transport: new TelegramBotApiTransport(telegramConfig),
    now: options.now,
  });
  return new GodReviewService({
    repositories,
    provider,
    modelKey: env.GOD_MODEL,
    reasoningEffort: parseGodReasoningEffort(env.GOD_REASONING_EFFORT),
    reputation,
    memory,
    telegram,
    now: options.now,
  });
}

export function createAgentScheduler(
  env: AgentRuntimeEnvironment & { readonly AGENT_JOBS: AgentJobQueue },
  options?: { readonly now?: () => string; readonly rng?: () => number },
): AgentScheduler {
  return new AgentScheduler({
    repositories: createRepositories(env.DB),
    queue: env.AGENT_JOBS,
    now: options?.now,
    rng: options?.rng,
  });
}

export function createKnowledgeScheduler(
  env: AgentRuntimeEnvironment & { readonly AGENT_JOBS: AgentJobQueue },
  options?: { readonly now?: () => string },
): KnowledgeScheduler {
  return new KnowledgeScheduler(createRepositories(env.DB), env.AGENT_JOBS, options?.now);
}

export function createReputationScheduler(
  env: AgentRuntimeEnvironment & { readonly AGENT_JOBS: AgentJobQueue },
  options?: { readonly now?: () => string },
): ReputationScheduler {
  return new ReputationScheduler({ repositories: createRepositories(env.DB), queue: env.AGENT_JOBS, now: options?.now });
}

export function createGodScheduler(
  env: AgentRuntimeEnvironment & { readonly AGENT_JOBS: AgentJobQueue },
  options?: { readonly now?: () => string; readonly enabled?: boolean },
): GodScheduler {
  return new GodScheduler({
    repositories: createRepositories(env.DB),
    queue: env.AGENT_JOBS,
    enabled: options?.enabled ?? false,
    now: options?.now,
  });
}
