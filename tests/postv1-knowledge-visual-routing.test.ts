import { describe, expect, it } from "vitest";

import { scoreCandidates, type AgentCandidateProfile } from "../src/agents/selection";
import type { AgentRecord, ThreadRecord } from "../src/database/types";
import { resolveVisualQuery } from "../src/knowledge/visual-resolution";

function profile(agentId: string, domain: string, description: string): AgentCandidateProfile {
  const agent: AgentRecord = {
    id: agentId,
    slug: agentId.replace(/^agent-/u, ""),
    displayName: agentId,
    specialty: domain,
    specialtyDescription: description,
    soul: "evidence first",
    personality: "direct",
    rank: 10,
    isSupervisor: false,
    isActive: true,
    config: {},
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
  return {
    agent,
    specialties: [{ agentId, domain, description, priority: 100, isPrimary: true }],
    interests: [],
  };
}

function openThread(): ThreadRecord {
  return { state: "open", priority: 60 } as ThreadRecord;
}

describe("post-v1 visual routing", () => {
  const profiles = [
    profile("agent-creative", "ux_creative", "UX UI interface design visual hierarchy and usability critique"),
    profile("agent-product", "product_strategy", "product value and user outcomes"),
    profile("agent-customer", "customer_experience", "customer clarity and user friction"),
    profile("agent-growth", "growth", "acquisition distribution retention and growth experiments"),
  ];

  it("routes an explicit Persian UX critique to Creative before phase-fit Growth", () => {
    const query = "صفحه ساخت تصویر الان چه شکلیه و چه ایراد UXی داره؟";
    const scored = scoreCandidates({ profiles, messageText: query, thread: openThread(), mode: "interactive", turnIndex: 0, rng: () => 0 });
    expect(scored[0]?.agentId).toBe("agent-creative");
    expect(scored[0]?.signals.intentRoutingBonus).toBe(20);
    expect(scored.find((candidate) => candidate.agentId === "agent-growth")?.signals.relevant).toBe(false);
  });

  it("supports English visual and UX vocabulary without making Growth the specialist", () => {
    const query = "What does the image generation page look like and what UX issues should we fix?";
    const target = resolveVisualQuery(query);
    expect(target.productConcept).toBe("image_generation");
    expect(target.uxIntent).toBe(true);
    const scored = scoreCandidates({ profiles, messageText: query, thread: openThread(), mode: "interactive", turnIndex: 0, rng: () => 0 });
    expect(scored[0]?.agentId).toBe("agent-creative");
  });

  it("keeps Growth preferred for a growth-only question", () => {
    const query = "How should we improve acquisition, distribution, and retention?";
    const scored = scoreCandidates({ profiles, messageText: query, thread: openThread(), mode: "interactive", turnIndex: 0, rng: () => 0 });
    expect(scored[0]?.agentId).toBe("agent-growth");
    expect(scored[0]?.signals.intentRoutingBonus).toBe(0);
  });
});
