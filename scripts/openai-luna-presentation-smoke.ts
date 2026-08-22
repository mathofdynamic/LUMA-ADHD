import { AGENT_STEP_JSON_SCHEMA, parseAgentStep } from "../src/agents/actions";
import { buildAgentPrompt } from "../src/agents/prompts";
import { LLMProviderError, OpenAIProvider, VERIFIED_OPENAI_MODEL } from "../src/llm";

const apiKey = process.env.GPT_API_KEY?.trim() ?? "";

function syntheticImageDataUrl(): string {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAABeUlEQVR42u3czU3DQBCA0TVKAekDrpFSAkVEtEAttIAoghIi5Rr6yMnyMQXwI+Gd9Y6t911DdoVfxgHL8jBNY9F2e3AIAAuwAAuwAAuwAAMWYAEWYAEWYAEGLMBaX7v/vuHx9bze3/br7WiCBViABViABViA/R+sxt0+n357af98BbxB1+8/00gacDfaH98Szgy4P21TZn9kJdINXwdwRt3Y1QBn1A1cE3BS3aiVAefVDVkfcGrd+l0AF9ei1XN8K/cCbILVe3xrdgRsggXY+TntvoBNsAALsAALsAALMGD9Xeu71QP3BWyCBdhZOu2OgE2wEgzx7L0Am2D1HuKaXQBnN65cH3Bq4/qVAec1DlkTcFLjqNUAZzQO/Kx4hEMT49m3XXpGx2aZPWVnxWdsz8ny3VxcyRJgAQYswAIswAIswAIMWIAFWBkbpml0FEywAAuwAAuwylL3ZB0+XhzBZbqc3k2wABcXOmSCBViABViABRiwAAuwUnYHPA5kuCljMg0AAAAASUVORK5CYII=";
}

function agentRecord(id: string, displayName: string, specialty: string, soul: string, personality: string): never {
  return {
    id,
    slug: id.replace(/^agent-/u, ""),
    displayName,
    specialty,
    specialtyDescription: specialty,
    soul,
    personality,
    rank: 10,
    isSupervisor: false,
    isActive: true,
    config: {},
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  } as never;
}

function thread(): never {
  return {
    id: "operator-presentation-smoke",
    chatId: null,
    title: "Presentation smoke",
    state: "open",
    priority: 50,
    summary: null,
    turnBudget: 1,
    turnsUsed: 0,
    phaseBudget: 1,
    phaseTurnsUsed: 0,
    cycleBudget: 1,
    cycleDepth: 0,
    createdByUserId: null,
    createdByAgentId: null,
    telegramTopicId: null,
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    closedAt: null,
    deletedAt: null,
  } as never;
}

function focus(query: string, currentImagePresent = false): never {
  return {
    primaryQuery: query,
    latestHumanMessage: query,
    latestHumanMessageAt: "2026-01-01T00:00:00.000Z",
    interactionIntent: "substantive",
    boundaryReason: null,
    currentBoundaryAt: "2026-01-01T00:00:00.000Z",
    retrievalSkippedReason: currentImagePresent ? "image_inspection" : null,
    threadObjective: query,
    recentDevelopment: null,
    unresolvedQuestion: query,
    keyTerms: query.split(/\s+/u).slice(0, 8),
    selectionQuery: query,
    retrievalQuery: currentImagePresent ? "" : query,
    isBroadQuestion: !currentImagePresent,
    isCurrentStateQuestion: false,
    currentImagePresent,
  } as never;
}

function capabilities(currentImagePresent: boolean): never {
  return {
    canSearchOwnFiles: true,
    canSearchSharedFiles: true,
    canUseOfficialLumaKnowledge: true,
    canRequestAgent: true,
    canRequestHuman: true,
    canCreateFiles: true,
    canCreateDiagram: true,
    visionModelSupported: true,
    currentImagePresent,
    currentImageFetchStatus: currentImagePresent ? "available" : "not_present",
    currentImageDeliveredToModel: currentImagePresent,
    currentImageCount: currentImagePresent ? 1 : 0,
  } as never;
}

function promptFor(agent: never, mode: "interactive" | "social", query: string, hasImage: boolean) {
  return buildAgentPrompt({
    agent,
    specialties: [],
    interests: [],
    thread: thread(),
    wakeReason: "human_message",
    mode,
    recentMessages: [],
    conversationFocus: focus(query, hasImage),
    capabilityManifest: capabilities(hasImage),
    groupState: {
      activeNormalAgents: ["agent-product", "agent-growth", "agent-creative", "agent-technical", "agent-finance", "agent-customer", "agent-operations", "agent-heretic"],
      currentInteractionMode: mode,
      invokedAgents: [],
      respondedAgents: [],
      pendingAgents: [],
    },
  });
}

const scenarios = [
  {
    id: "social",
    agent: agentRecord("agent-customer", "Sara", "customer experience", "Notice trust and real user pain.", "Warm and concise."),
    mode: "social" as const,
    query: "سلام",
    content: [{ type: "text" as const, text: "سلام" }],
  },
  {
    id: "image",
    agent: agentRecord("agent-creative", "Nila", "UX and visual clarity", "Notice hierarchy and visual clarity.", "Curious and precise."),
    mode: "interactive" as const,
    query: "این تصویر چیه؟ اگر چند مشاهده مستقل مهم است، پاسخ را برای خواندن سریع در تلگرام ساختاربندی کن.",
    content: [
      { type: "text" as const, text: "این تصویر چیه؟ اگر چند مشاهده مستقل مهم است، پاسخ را برای خواندن سریع در تلگرام ساختاربندی کن." },
      { type: "image_data" as const, dataUrl: syntheticImageDataUrl(), detail: "auto" as const },
    ],
  },
  {
    id: "analytical",
    agent: agentRecord("agent-product", "Radin", "product value and prioritization", "Notice user value and trade-offs.", "Decisive but evidence-aware."),
    mode: "interactive" as const,
    query: "سه مشاهده مستقل از این تصمیم را با جمع‌بندی کوتاه و بدون ادعای قطعیِ بدون شواهد توضیح بده.",
    content: [{ type: "text" as const, text: "سه مشاهده مستقل از این تصمیم را با جمع‌بندی کوتاه و بدون ادعای قطعیِ بدون شواهد توضیح بده." }],
  },
  {
    id: "technical",
    agent: agentRecord("agent-technical", "Kian", "architecture and reliability", "Notice failure modes and feasibility.", "Precise and practical."),
    mode: "interactive" as const,
    query: "برای این پاسخ فنی، نام identifier و یک قطعه کوتاه config را خوانا و قابل اسکن نشان بده.",
    content: [{ type: "text" as const, text: "برای این پاسخ فنی، نام identifier و یک قطعه کوتاه config را خوانا و قابل اسکن نشان بده." }],
  },
] as const;

if (apiKey.length === 0) {
  console.log("GPT_API_KEY_AVAILABLE=false");
  process.exitCode = 2;
} else {
  const provider = new OpenAIProvider({ apiKey, model: VERIFIED_OPENAI_MODEL, maxAttempts: 1 });
  let failed = false;
  const requestedScenario = process.env.PRESENTATION_SMOKE_SCENARIO?.trim();
  const selectedScenarios = requestedScenario
    ? scenarios.filter((scenario) => scenario.id === requestedScenario)
    : scenarios;
  if (selectedScenarios.length === 0) {
    console.error("PRESENTATION_SMOKE_FAILURE=unknown_scenario");
    process.exitCode = 2;
  }
  for (const scenario of selectedScenarios) {
    try {
      const startedAt = Date.now();
      const response = await provider.generate({
        modelKey: VERIFIED_OPENAI_MODEL,
        systemPrompt: promptFor(scenario.agent, scenario.mode, scenario.query, scenario.id === "image").systemPrompt,
        messages: [{ role: "user", content: scenario.content }],
        reasoningEffort: "medium",
        maxOutputTokens: 512,
        structuredOutput: {
          name: `luma_presentation_${scenario.id}`,
          description: "A bounded Telegram presentation smoke.",
          schema: AGENT_STEP_JSON_SCHEMA,
        },
      });
      const parsed = parseAgentStep(response.text);
      const action = parsed.kind === "action" ? parsed.action : null;
      if (!action || !["SPEAK", "WAIT"].includes(action.intent)) throw new Error("unexpected action");
      console.log(`PRESENTATION_SMOKE_${scenario.id.toUpperCase()}=success`);
      console.log(`PRESENTATION_SMOKE_${scenario.id.toUpperCase()}_INTENT=${action.intent}`);
      console.log(`PRESENTATION_SMOKE_${scenario.id.toUpperCase()}_CONTENT=${JSON.stringify(action.content ?? null)}`);
      console.log(`PRESENTATION_SMOKE_${scenario.id.toUpperCase()}_LATENCY_MS=${response.latencyMs}`);
      console.log(`PRESENTATION_SMOKE_${scenario.id.toUpperCase()}_ELAPSED_MS=${Date.now() - startedAt}`);
    } catch (error: unknown) {
      failed = true;
      const category = error instanceof LLMProviderError
        ? `${error.failure.kind}${error.failure.status === undefined ? "" : `_${error.failure.status}`}`
        : "validation_or_unknown";
      const detail = error instanceof LLMProviderError
        ? error.failure.message
        : error instanceof Error ? error.message.replace(/\s+/gu, " ").slice(0, 240) : "unknown error";
      console.error(`PRESENTATION_SMOKE_${scenario.id.toUpperCase()}=failure_${category}: ${detail}`);
    }
  }
  if (failed) process.exitCode = 1;
}
