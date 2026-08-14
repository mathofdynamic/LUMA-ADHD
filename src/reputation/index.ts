export type ReputationDimension =
  | "epistemic"
  | "contribution"
  | "collaboration"
  | "outcome";

export interface ReputationSnapshot {
  readonly agentId: string;
  readonly domain: string;
  readonly dimensions: Readonly<Record<ReputationDimension, number>>;
  readonly capturedAt: string;
}
