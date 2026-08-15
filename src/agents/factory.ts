import type { D1Database } from "@cloudflare/workers-types";
import { createRepositories } from "../database/repositories";
import { NebulaProvider, DEFAULT_NEBULA_MODEL, VERIFIED_NEBULA_BASE_URL, type LLMProvider } from "../llm";
import { createTelegramApplication, TelegramBotApiTransport, parseTelegramConfig } from "../telegram";
import { AgentRuntimeService, type AgentRuntimeDependencies } from "./runtime";
import { AgentScheduler, type AgentJobQueue } from "./scheduler";

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
  readonly TELEGRAM_GOD_BOT_TOKEN?: string;
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
    now: options?.now,
    rng: options?.rng,
  };
  return new AgentRuntimeService(dependencies);
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
