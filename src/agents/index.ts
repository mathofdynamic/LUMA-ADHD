export type AgentId =
  | "product"
  | "growth"
  | "creative"
  | "technical"
  | "finance"
  | "customer"
  | "operations"
  | "heretic"
  | "god";

export interface AgentIdentity {
  readonly id: AgentId;
  readonly displayName: string;
  readonly specialty: string;
}

/** Identity metadata only. Orchestration begins in a later phase. */
export const FOUNDATION_AGENT_IDENTITIES: readonly AgentIdentity[] = [
  { id: "product", displayName: "Product Strategist", specialty: "Product strategy" },
  { id: "growth", displayName: "Growth Strategist", specialty: "Growth" },
  { id: "creative", displayName: "Creative Director", specialty: "UX and creative direction" },
  { id: "technical", displayName: "Technical Architect", specialty: "Engineering and architecture" },
  { id: "finance", displayName: "Finance Analyst", specialty: "Finance and pricing" },
  { id: "customer", displayName: "Customer Advocate", specialty: "Customer experience" },
  { id: "operations", displayName: "Operations Strategist", specialty: "Operations" },
  { id: "heretic", displayName: "Contrarian", specialty: "Critical analysis" },
  { id: "god", displayName: "GOD", specialty: "Supervisory intelligence" },
];
