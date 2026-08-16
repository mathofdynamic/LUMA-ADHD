export interface MemoryRecord {
  readonly id: string;
  readonly scope: "agent" | "organization" | "thread";
  readonly content: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
