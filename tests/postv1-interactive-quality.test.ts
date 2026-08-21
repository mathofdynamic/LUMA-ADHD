import { describe, expect, it } from "vitest";
import {
  assessContributionDuplication,
  assessOfficialGrounding,
  assessCurrentStateGrounding,
  buildConversationFocus,
  buildAgentPrompt,
  classifyConversationIntent,
  decideThreadContinuation,
  chooseCandidateFromScores,
  qualifyUnsupportedCurrentClaim,
  scoreCandidates,
  TELEGRAM_PRESENTATION_GUIDANCE,
  AGENT_PROMPT_VERSION,
  type AgentCandidateProfile,
  type AgentSelectionActivity,
} from "../src/agents";
import type { AgentRecord, MessageRecord, ThreadRecord } from "../src/database/types";
import type { ContextPack } from "../src/memory/types";

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

function activity(overrides: Partial<AgentSelectionActivity> = {}): AgentSelectionActivity {
  return {
    lastTurnAt: null,
    lastThreadTurnAt: null,
    lastAmbientOpportunityAt: null,
    recentOpportunityCount: 0,
    recentMeaningfulContributionCount: 0,
    recentThreadOpportunityCount: 0,
    recentThreadMeaningfulContributionCount: 0,
    ...overrides,
  };
}

function thread(state = "open"): ThreadRecord {
  return { id: "quality-thread", title: "LUMA discussion", state, priority: 60, summary: null } as ThreadRecord;
}

function message(input: Partial<MessageRecord> & Pick<MessageRecord, "id" | "contentText" | "authorType" | "createdAt">): MessageRecord {
  return {
    threadId: "quality-thread",
    chatId: null,
    authorAgentId: null,
    authorUserId: input.authorType === "human" ? "human-1" : null,
    replyToMessageId: null,
    origin: "internal",
    visibility: "public",
    telegramChatId: null,
    telegramMessageId: null,
    telegramBotAlias: null,
    metadata: {},
    deletedAt: null,
    ...input,
  } as MessageRecord;
}

function contextPack(items: ContextPack["items"]): ContextPack {
  return {
    query: "current LUMA status",
    items,
    totalCharacters: items.reduce((total, item) => total + item.excerpt.length, 0),
    truncated: false,
    telemetry: {
      queryIntent: "discussion",
      retrievalCount: items.length,
      sourceTypeCounts: Object.fromEntries(items.map((item) => [item.type, 1])),
      officialKnowledgeCount: 0,
      agentDocumentCount: 0,
      sharedDocumentCount: items.filter((item) => item.type === "document").length,
      totalRetrievedCharacters: items.reduce((total, item) => total + item.excerpt.length, 0),
      contextTruncated: false,
      acquisitionOperations: 0,
    },
  };
}

describe("post-v1 interactive discussion quality", () => {
  it("does not treat open-thread phase fit as interactive eligibility", () => {
    const profiles = [
      profile("agent-product", "product_strategy", "product strategy and prioritization"),
      profile("agent-technical", "engineering_architecture", "backend architecture, latency, and reliability"),
      profile("agent-finance", "finance_pricing", "pricing and unit economics"),
    ];
    const scored = scoreCandidates({
      profiles,
      messageText: "backend latency architecture",
      thread: thread("open"),
      mode: "interactive",
      turnIndex: 0,
      rng: () => 0,
    });
    expect(scored.find((candidate) => candidate.agentId === "agent-product")?.relevanceScore).toBe(0);
    expect(chooseCandidateFromScores(scored, { mode: "interactive", turnIndex: 0, rng: () => 0 }).candidate?.agentId).toBe("agent-technical");
  });

  it("broad questions admit uncovered perspectives without round-robin routing", () => {
    const profiles = [
      profile("agent-product", "product_strategy", "product strategy"),
      profile("agent-customer", "customer_experience", "customer onboarding and support"),
      profile("agent-finance", "finance_pricing", "pricing and unit economics"),
      profile("agent-technical", "engineering_architecture", "backend architecture"),
    ];
    const scored = scoreCandidates({
      profiles,
      messageText: "وضعیت فعلی لوما و مهم ترین مسائل",
      thread: thread("open"),
      mode: "interactive",
      isBroadQuestion: true,
      coveredDomains: ["product_strategy"],
      turnIndex: 1,
      rng: () => 0,
    });
    expect(scored.every((candidate) => candidate.relevanceScore > 0)).toBe(true);
    expect(scored.find((candidate) => candidate.agentId === "agent-customer")?.signals.coverageBonus).toBeGreaterThan(0);
    expect(scored.find((candidate) => candidate.agentId === "agent-product")?.signals.coveragePenalty).toBeGreaterThan(0);
  });

  it("keeps direct address stronger than coverage and exploration", () => {
    const scored = scoreCandidates({
      profiles: [
        profile("agent-product", "product_strategy", "product strategy"),
        profile("agent-finance", "finance_pricing", "pricing and unit economics"),
      ],
      messageText: "بچه ها این تصمیم را بررسی کنید",
      thread: thread("open"),
      mode: "interactive",
      isBroadQuestion: true,
      addressedAgentId: "agent-finance",
      coveredDomains: ["finance_pricing"],
      turnIndex: 0,
      rng: () => 1,
    });
    expect(chooseCandidateFromScores(scored, { mode: "interactive", addressedAgentId: "agent-finance", turnIndex: 0, rng: () => 1 }).candidate?.agentId).toBe("agent-finance");
  });

  it("retains the substantive focus when the latest human message is a nudge", () => {
    const original = message({ id: "human-original", authorType: "human", createdAt: "2026-08-17T05:00:00.000Z", contentText: "مهم ترین مشکل تجربه کاربری لوما چیست؟" });
    const nudge = message({ id: "human-nudge", authorType: "human", createdAt: "2026-08-17T05:01:00.000Z", contentText: "کسی نیست جواب منو بده ؟!", replyToMessageId: original.id });
    const focus = buildConversationFocus({
      thread: { ...thread(), summary: null },
      wakeMessage: nudge,
      anchorMessage: original,
      recentMessages: [original, nudge],
    });
    expect(focus.interactionIntent).toBe("nudge");
    expect(focus.primaryQuery).toContain("تجربه کاربری");
    expect(focus.retrievalQuery).toContain("تجربه کاربری");
    expect(focus.retrievalQuery).not.toBe(nudge.contentText);
  });

  it("updates focus with the newest meaningful Agent development", () => {
    const human = message({ id: "human", authorType: "human", createdAt: "2026-08-17T05:00:00.000Z", contentText: "بررسی onboarding لوما" });
    const agent = message({ id: "agent", authorType: "agent", authorAgentId: "agent-product", createdAt: "2026-08-17T05:01:00.000Z", contentText: "یک ریسک فنی در زمان رسیدن به first value پیدا شد." });
    const focus = buildConversationFocus({ thread: thread(), wakeMessage: human, recentMessages: [human, agent] });
    expect(focus.recentDevelopment).toContain("ریسک فنی");
    expect(focus.selectionQuery).toContain("first value");
  });

  it("suppresses a semantically repeated second contribution while allowing a distinct one", () => {
    const first = "مشکل اصلی onboarding این است که مسیر رسیدن کاربر به اولین ارزش روشن نیست و فعال سازی را پایین می آورد.";
    const repeated = "مسیر رسیدن کاربر به ارزش اولیه در onboarding واضح نیست و نرخ فعال سازی افت می کند.";
    const distinct = "از دید مالی هنوز داده ای برای سنجش هزینه جذب یا سودآوری این فرضیه نداریم.";
    expect(assessContributionDuplication(repeated, [first]).duplicate).toBe(true);
    expect(assessContributionDuplication(distinct, [first]).duplicate).toBe(false);
  });

  it("qualifies a current-ranking claim when retrieved material is only a proposal", () => {
    const pack = contextPack([{
      type: "document",
      sourceId: "pricing-plan",
      title: "Future pricing plan",
      pathOrUrl: "/shared/research/luma-subscription-plan.md",
      excerpt: "این برنامه پیشنهادی آینده است و نیازمند اعتبارسنجی است؛ مدل قیمت گذاری فعلی را ثابت نمی کند.",
      authority: 60,
      score: 1,
      updatedAt: "2026-08-15T00:00:00.000Z",
      provenance: { source: "proposal" },
    }]);
    const content = "یکی از سه مشکل اصلی فعلی لوما ابهام مدل تجاری است.";
    const assessment = assessCurrentStateGrounding(content, pack);
    expect(assessment.supported).toBe(false);
    expect(assessment.state).toBe("unsupported");
    expect(qualifyUnsupportedCurrentClaim(content, assessment)).toContain("فرضیه");
  });

  it("does not require an irrelevant official chunk to answer a current-state diagnosis", () => {
    const pack: ContextPack = {
      ...contextPack([{
        type: "knowledge_chunk",
        sourceId: "terms-of-use-1",
        title: "Official terms",
        pathOrUrl: "https://example.invalid/terms.md",
        excerpt: "هزینه و شرایط استفاده از خروجی در این سند توضیح داده می‌شود.",
        authority: 100,
        score: 1,
        updatedAt: "2026-08-21T00:00:00.000Z",
        provenance: { source: "official" },
      }]),
      telemetry: {
        ...contextPack([]).telemetry,
        queryIntent: "official_factual",
        officialKnowledgeCount: 1,
      },
    };
    const assessment = assessOfficialGrounding("اطلاعات فعلی برای رتبه‌بندی کافی نیست.", pack, { currentStateQuestion: true });
    expect(assessment.required).toBe(false);
    expect(assessment.satisfied).toBe(true);
  });

  it("keeps a technical specialist ahead of neglected but irrelevant finance", () => {
    const scored = scoreCandidates({
      profiles: [
        profile("agent-technical", "engineering_architecture", "backend architecture latency and reliability"),
        profile("agent-finance", "finance_pricing", "pricing unit economics and subscription"),
      ],
      messageText: "مشکل latency معماری backend چیست؟",
      thread: thread("open"),
      mode: "interactive",
      turnIndex: 0,
      activityByAgentId: { "agent-finance": activity({ recentOpportunityCount: 0 }) },
      rng: () => 0,
    });
    expect(chooseCandidateFromScores(scored, { mode: "interactive", turnIndex: 0, rng: () => 1 }).candidate?.agentId).toBe("agent-technical");
  });

  it("honors a valid specialist request over broad phase preference", () => {
    const scored = scoreCandidates({
      profiles: [
        profile("agent-product", "product_strategy", "product strategy"),
        profile("agent-technical", "engineering_architecture", "backend architecture"),
      ],
      messageText: "بچه ها این موضوع را بررسی کنید",
      thread: thread("open"),
      mode: "interactive",
      isBroadQuestion: true,
      requestedAgentIds: ["agent-technical"],
      turnIndex: 1,
      rng: () => 0,
    });
    expect(chooseCandidateFromScores(scored, { mode: "interactive", turnIndex: 1, rng: () => 0 }).candidate?.agentId).toBe("agent-technical");
  });

  it("uses cross-job thread opportunity history without imposing a fixed rotation", () => {
    const profiles = [
      profile("agent-product", "product_strategy", "product strategy and user value"),
      profile("agent-customer", "customer_experience", "customer onboarding and support"),
    ];
    const scored = scoreCandidates({
      profiles,
      messageText: "onboarding user value",
      thread: thread("open"),
      mode: "interactive",
      turnIndex: 0,
      activityByAgentId: {
        "agent-product": activity({ recentOpportunityCount: 6, recentThreadOpportunityCount: 3 }),
        "agent-customer": activity(),
      },
      rng: () => 0,
    });
    expect(scored[0]?.agentId).toBe("agent-customer");
    expect(scored.find((candidate) => candidate.agentId === "agent-product")?.reasons).toContain("cross-job thread recency penalty");
  });

  it("classifies social, acknowledgement, correction, and mixed substantive messages", () => {
    expect(classifyConversationIntent("سلام").interactionIntent).toBe("social");
    expect(classifyConversationIntent("ممنون").interactionIntent).toBe("acknowledgement");
    expect(classifyConversationIntent("گفتم سلام فقط").interactionIntent).toBe("correction");
    expect(classifyConversationIntent("سلام، مدل قیمت‌گذاری رو بررسی کنید").interactionIntent).toBe("substantive");
  });

  it("starts a fresh social boundary without importing old strategic development", () => {
    const oldHuman = message({ id: "old-human", authorType: "human", createdAt: "2026-08-17T05:00:00.000Z", contentText: "وضعیت فعلی محصول را بررسی کنید" });
    const oldAgent = message({ id: "old-agent", authorType: "agent", authorAgentId: "agent-product", createdAt: "2026-08-17T05:01:00.000Z", contentText: "تحلیل قدیمی و طولانی درباره محصول" });
    const greeting = message({ id: "greeting", authorType: "human", createdAt: "2026-08-21T07:46:35.000Z", contentText: "سلام" });
    const focus = buildConversationFocus({
      thread: { ...thread(), summary: "قدیمی: تحلیل استراتژیک" },
      wakeMessage: greeting,
      recentMessages: [oldHuman, oldAgent, greeting],
    });
    expect(focus.interactionIntent).toBe("social");
    expect(focus.primaryQuery).toBe("سلام");
    expect(focus.recentDevelopment).toBeNull();
    expect(focus.retrievalQuery).toBe("");
    expect(focus.isBroadQuestion).toBe(false);
    expect(focus.isCurrentStateQuestion).toBe(false);
  });

  it("uses explicit reply continuity but refuses an old ambiguous strategic thread", () => {
    const old = { ...thread(), lastActivityAt: "2026-08-17T05:00:00.000Z" } as ThreadRecord;
    const oldQuestion = message({ id: "old-question", authorType: "human", createdAt: "2026-08-17T04:59:00.000Z", contentText: "مدل قیمت گذاری را بررسی کنید" });
    const directReply = decideThreadContinuation({
      candidateThread: old,
      recentMessages: [oldQuestion],
      text: "این بخش را بیشتر توضیح بده",
      now: "2026-08-21T07:46:00.000Z",
      hasDirectReply: true,
    });
    const greeting = decideThreadContinuation({
      candidateThread: old,
      recentMessages: [oldQuestion],
      text: "سلام",
      now: "2026-08-21T07:46:00.000Z",
    });
    expect(directReply.continueThread).toBe(true);
    expect(directReply.reason).toBe("explicit_telegram_reply");
    expect(greeting.continueThread).toBe(false);
    expect(greeting.classification.interactionIntent).toBe("social");
  });

  it("keeps the identity model ahead of the action contract and makes social prompts small", () => {
    const product = profile("agent-product", "product_strategy", "product value and prioritization");
    const workFocus = buildConversationFocus({ thread: thread(), wakeMessage: null, recentMessages: [] });
    const work = buildAgentPrompt({
      agent: product.agent,
      specialties: product.specialties,
      interests: product.interests,
      thread: thread(),
      wakeReason: "human_message",
      mode: "interactive",
      conversationFocus: workFocus,
      participants: [{ id: product.agent.id, displayName: product.agent.displayName, kind: "agent" }],
    });
    const greeting = message({ id: "prompt-greeting", authorType: "human", createdAt: "2026-08-21T07:46:35.000Z", contentText: "سلام" });
    const socialFocus = buildConversationFocus({ thread: thread(), wakeMessage: greeting, recentMessages: [greeting] });
    const social = buildAgentPrompt({
      agent: product.agent,
      specialties: product.specialties,
      interests: product.interests,
      thread: thread(),
      wakeReason: "human_message",
      mode: "social",
      conversationFocus: socialFocus,
      recentMessages: [greeting],
    });
    expect(work.systemPrompt.startsWith("ORGANIZATIONAL CONSTITUTION")).toBe(true);
    expect(work.systemPrompt).toContain("You are agent-product");
    expect(work.systemPrompt).toContain("GOD / agent-god");
    expect(work.systemPrompt).toContain("current intent outranks old context");
    expect(work.systemPrompt).toContain("OUTPUT CONTRACT");
    expect(work.systemPrompt).toContain(AGENT_PROMPT_VERSION);
    expect(TELEGRAM_PRESENTATION_GUIDANCE).not.toContain("Activation Rate");
    expect(TELEGRAM_PRESENTATION_GUIDANCE).not.toContain("onboarding");
    expect(social.systemPrompt).toContain("SOCIAL / ACKNOWLEDGEMENT FAST PATH");
    expect(social.systemPrompt).not.toContain("bounded_retrieval_context");
    expect(social.systemPrompt.length).toBeLessThan(work.systemPrompt.length);
  });

  it("supports a bounded social selection mode without phase-driven strategy routing", () => {
    const scored = scoreCandidates({
      profiles: [
        profile("agent-product", "product_strategy", "product value"),
        profile("agent-technical", "engineering_architecture", "architecture"),
      ],
      messageText: "سلام",
      thread: thread("open"),
      mode: "social",
      turnIndex: 0,
      rng: () => 0,
    });
    expect(scored.every((candidate) => candidate.relevanceScore > 0)).toBe(true);
    expect(chooseCandidateFromScores(scored, { mode: "social", turnIndex: 0, rng: () => 1 }).explorationPool).toHaveLength(2);
  });
});
