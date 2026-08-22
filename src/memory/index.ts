import type { createRepositories } from "../database/repositories";
import { DocumentService } from "./document-service";
import { ContextPackService, InstitutionalMemorySearch } from "./retrieval";
import { KnowledgeSyncService } from "../knowledge/sync";
import { ThreadSummaryService } from "./summary";
import type { LLMProvider, LLMReasoningEffort } from "../llm";
import type { MemoryRecord } from "./legacy-types";
import type { LumaKnowledgeClient } from "../knowledge/client";
import { KnowledgeV2Repository } from "../knowledge/v2-repository";
import { KnowledgeV2Service } from "../knowledge/v2-service";

export type { MemoryActor, ContextPack, ContextPackItem, ContextPackTelemetry, MemoryItemType } from "./types";
export * from "./paths";
export * from "./document-service";
export * from "./fts";
export * from "./repositories";
export * from "./retrieval";
export * from "./types";
export * from "./summary";

export interface MemoryServices {
  readonly documents: DocumentService;
  readonly search: InstitutionalMemorySearch;
  readonly context: ContextPackService;
  readonly knowledge: KnowledgeSyncService;
  readonly knowledgeV2?: KnowledgeV2Service;
  readonly summaries: ThreadSummaryService;
}

export function createMemoryServices(
  repositories: ReturnType<typeof createRepositories>,
  options?: { readonly provider?: LLMProvider; readonly modelKey?: string; readonly reasoningEffort?: LLMReasoningEffort; readonly knowledgeClient?: LumaKnowledgeClient },
): MemoryServices {
  const knowledgeV2 = options?.knowledgeClient
    ? new KnowledgeV2Service(new KnowledgeV2Repository(repositories.database), options.knowledgeClient, undefined, repositories.events)
    : undefined;
  return {
    documents: new DocumentService(repositories),
    search: new InstitutionalMemorySearch(repositories.database),
    context: new ContextPackService(repositories.database, knowledgeV2),
    knowledge: new KnowledgeSyncService(repositories, { knowledgeV2 }),
    knowledgeV2,
    summaries: new ThreadSummaryService(repositories, options),
  };
}

// Kept as a small compatibility seam for the pre-Phase-04 placeholder module.
export type { MemoryRecord };
