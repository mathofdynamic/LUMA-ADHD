import type { createRepositories } from "../database/repositories";
import { DocumentService } from "./document-service";
import { ContextPackService, InstitutionalMemorySearch } from "./retrieval";
import { KnowledgeSyncService } from "../knowledge/sync";
import { ThreadSummaryService } from "./summary";
import type { LLMProvider } from "../llm";
import type { MemoryRecord } from "./legacy-types";

export type { MemoryActor, ContextPack, ContextPackItem, MemoryItemType } from "./types";
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
  readonly summaries: ThreadSummaryService;
}

export function createMemoryServices(
  repositories: ReturnType<typeof createRepositories>,
  options?: { readonly provider?: LLMProvider; readonly modelKey?: string },
): MemoryServices {
  return {
    documents: new DocumentService(repositories),
    search: new InstitutionalMemorySearch(repositories.database),
    context: new ContextPackService(repositories.database),
    knowledge: new KnowledgeSyncService(repositories),
    summaries: new ThreadSummaryService(repositories, options),
  };
}

// Kept as a small compatibility seam for the pre-Phase-04 placeholder module.
export type { MemoryRecord };
