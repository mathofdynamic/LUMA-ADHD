import type { JsonObject } from "../database/validation";

export const DIAGRAM_TYPES = ["architecture", "flow", "process", "comparison", "decision_tree"] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export type DiagramDirection = "rtl" | "ltr";

export interface DiagramNode {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
  readonly groupId?: string | null;
}

export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly relation?: string;
}

export interface DiagramGroup {
  readonly id: string;
  readonly label: string;
  readonly nodeIds?: readonly string[];
}

export interface DiagramSpec {
  readonly diagramType: DiagramType;
  readonly title: string;
  readonly direction: DiagramDirection;
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly groups: readonly DiagramGroup[];
  readonly notes: readonly string[];
}

export interface DiagramActor {
  readonly agentId?: string;
  readonly userId?: string;
}

export interface DiagramCreateInput {
  readonly spec: unknown;
  readonly threadId?: string;
  readonly messageId?: string;
  readonly actor: DiagramActor;
  readonly idempotencyKey: string;
  readonly metadata?: JsonObject;
}

export interface DiagramRenderInput {
  readonly artifactId: string;
  readonly title: string;
  readonly html: string;
}

export type DiagramRenderResult =
  | { readonly status: "rendered"; readonly telegramFileId?: string; readonly metadata?: JsonObject }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "quota_exhausted"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string };

export interface DiagramRenderer {
  render(input: DiagramRenderInput): Promise<DiagramRenderResult>;
}
