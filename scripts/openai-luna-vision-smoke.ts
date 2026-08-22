import { AGENT_STEP_JSON_SCHEMA, parseAgentStep } from "../src/agents/actions";
import { buildAgentPrompt } from "../src/agents/prompts";
import { LLMProviderError, OpenAIProvider, VERIFIED_OPENAI_MODEL } from "../src/llm";

const apiKey = process.env.GPT_API_KEY?.trim() ?? "";
if (apiKey.length === 0) {
  console.log("GPT_API_KEY_AVAILABLE=false");
  process.exitCode = 2;
} else {
  const provider = new OpenAIProvider({ apiKey, model: VERIFIED_OPENAI_MODEL, maxAttempts: 1 });
  const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const prompt = buildAgentPrompt({
    agent: {
      id: "agent-creative",
      slug: "nila",
      displayName: "Nila",
      specialty: "creative",
      specialtyDescription: "UX and visual clarity",
      soul: "Notice clarity and experience quality.",
      personality: "Curious and precise.",
      rank: 10,
      isSupervisor: false,
      isActive: true,
      config: {},
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    },
    specialties: [],
    interests: [],
    thread: {
      id: "operator-vision-smoke",
      chatId: null,
      title: "Vision smoke",
      state: "open",
      priority: 50,
      summary: "Inspect the current image only.",
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
    },
    wakeReason: "human_message",
    mode: "interactive",
    recentMessages: [],
    conversationFocus: {
      primaryQuery: "این تصویر چیه؟",
      latestHumanMessage: "این تصویر چیه؟",
      latestHumanMessageAt: "2026-01-01T00:00:00.000Z",
      interactionIntent: "substantive",
      boundaryReason: null,
      currentBoundaryAt: "2026-01-01T00:00:00.000Z",
      retrievalSkippedReason: "image_inspection",
      threadObjective: "Inspect the current image only.",
      recentDevelopment: null,
      unresolvedQuestion: "این تصویر چیه؟",
      keyTerms: ["تصویر"],
      selectionQuery: "این تصویر چیه؟",
      retrievalQuery: "",
      isBroadQuestion: false,
      isCurrentStateQuestion: false,
      currentImagePresent: true,
    },
    capabilityManifest: {
      canSearchOwnFiles: true,
      canSearchSharedFiles: true,
      canUseOfficialLumaKnowledge: true,
      canRequestAgent: true,
      canRequestHuman: true,
      canCreateFiles: true,
      canCreateDiagram: true,
      visionModelSupported: true,
      currentImagePresent: true,
      currentImageFetchStatus: "available",
      currentImageDeliveredToModel: true,
      currentImageCount: 1,
    },
    groupState: {
      activeNormalAgents: ["agent-product", "agent-growth", "agent-creative", "agent-technical", "agent-finance", "agent-customer", "agent-operations", "agent-heretic"],
      currentInteractionMode: "interactive",
      invokedAgents: ["agent-creative"],
      respondedAgents: [],
      pendingAgents: [],
    },
  });

  try {
    const startedAt = Date.now();
    const response = await provider.generate({
      modelKey: VERIFIED_OPENAI_MODEL,
      systemPrompt: prompt.systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "این تصویر چیه؟ فقط یک پاسخ کوتاه و دقیق بده." },
          { type: "image_data", dataUrl: imageDataUrl, detail: "auto" },
        ],
      }],
      reasoningEffort: "medium",
      maxOutputTokens: 512,
      structuredOutput: {
        name: "luma_agent_step_vision_smoke",
        description: "A bounded normal-Agent image-input smoke.",
        schema: AGENT_STEP_JSON_SCHEMA,
      },
    });
    const parsed = parseAgentStep(response.text);
    if (parsed.kind !== "action" || !["SPEAK", "WAIT"].includes(parsed.action.intent)) {
      throw new Error("vision smoke returned an unexpected action");
    }
    console.log("OPENAI_LUNA_VISION_SMOKE=success");
    console.log(`OPENAI_LUNA_VISION_INTENT=${parsed.action.intent}`);
    console.log(`OPENAI_LUNA_VISION_USAGE_AVAILABLE=${response.usage !== undefined}`);
    console.log(`OPENAI_LUNA_VISION_REQUEST_ID_PRESENT=${response.requestId !== undefined}`);
    console.log(`OPENAI_LUNA_VISION_LATENCY_MS=${response.latencyMs}`);
    console.log(`OPENAI_LUNA_VISION_TOTAL_ELAPSED_MS=${Date.now() - startedAt}`);
  } catch (error: unknown) {
    console.error(`OPENAI_LUNA_VISION_SMOKE_FAILURE=${error instanceof LLMProviderError ? `${error.failure.kind}${error.failure.status === undefined ? "" : `_${error.failure.status}`}` : "validation_or_unknown"}`);
    process.exitCode = 1;
  }
}
