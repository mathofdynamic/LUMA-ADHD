import type { createRepositories } from "../database/repositories";
import { TelegramConfigurationError, type TelegramConfig } from "./config";
import { TelegramInboundService } from "./inbound";
import { TelegramOutboundService } from "./outbound";
import type {
  TelegramAgentProjectionInput,
  TelegramAgentProjectionResult,
  TelegramInboundResult,
  TelegramTransport,
  TelegramUpdateEnvelope,
} from "./types";

type TelegramRepositories = ReturnType<typeof createRepositories>;

export function webhookPath(botAlias: string): string {
  if (!/^[a-z0-9-]+$/u.test(botAlias)) {
    throw new Error("botAlias must contain lowercase letters, numbers, or hyphens");
  }

  return `/telegram/webhook/${botAlias}`;
}

export interface TelegramApplicationDependencies {
  readonly repositories: TelegramRepositories;
  readonly config: TelegramConfig;
  readonly transport?: TelegramTransport;
  readonly now?: () => string;
}

export class TelegramApplicationService {
  private readonly inbound: TelegramInboundService;
  private readonly outbound: TelegramOutboundService | null;

  constructor(dependencies: TelegramApplicationDependencies) {
    this.inbound = new TelegramInboundService(dependencies);
    this.outbound = dependencies.transport
      ? new TelegramOutboundService({ ...dependencies, transport: dependencies.transport })
      : null;
  }

  ingest(envelope: TelegramUpdateEnvelope): Promise<TelegramInboundResult> {
    return this.inbound.ingest(envelope.payload, envelope.botAlias, envelope.receivedAt);
  }

  async projectAgentMessage(
    input: TelegramAgentProjectionInput,
  ): Promise<TelegramAgentProjectionResult> {
    if (!this.outbound) {
      throw new TelegramConfigurationError("an outbound Telegram transport has not been configured");
    }

    return this.outbound.projectAgentMessage(input);
  }
}

export function createTelegramApplication(
  dependencies: TelegramApplicationDependencies,
): TelegramApplicationService {
  return new TelegramApplicationService(dependencies);
}

export * from "./config";
export * from "./format";
export * from "./normalize";
export * from "./transport";
export * from "./types";
