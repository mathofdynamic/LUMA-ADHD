import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createRepositories } from "../src/database";
import { AgentRuntimeService } from "../src/agents/runtime";
import { FakeProvider } from "../src/llm/fake";
import { OpenAIProvider } from "../src/llm/openai";
import {
  enforceVisionCapabilityTruth,
  type AgentCapabilityManifest,
} from "../src/agents/capabilities";
import {
  createTelegramApplication,
  TelegramMediaFetcher,
  normalizeTelegramUpdate,
  parseTelegramConfig,
  type TelegramSendTextInput,
  type TelegramSentMessage,
  type TelegramTransport,
  TelegramTransportError,
} from "../src/telegram";

const repositories = createRepositories(env.DB);
const groupId = "-100200300";

function configWithRoster(workspace = groupId) {
  const aliases = [
    ["gateway", null], ["product", "agent-product"], ["growth", "agent-growth"],
    ["creative", "agent-creative"], ["technical", "agent-technical"], ["finance", "agent-finance"],
    ["customer", "agent-customer"], ["operations", "agent-operations"], ["heretic", "agent-heretic"],
  ] as const;
  return parseTelegramConfig({
    TELEGRAM_GROUP_ID: workspace,
    TELEGRAM_ADMIN_USER_IDS: "42",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify(Object.fromEntries(aliases.map(([alias, agentId], index) => [
      alias,
      { telegramUserId: String(9000 + index), username: `luma_${alias}` },
    ]))),
  });
}

function baseMessage(messageId: number, workspace = groupId): Record<string, unknown> {
  return {
    message_id: messageId,
    from: { id: 42, is_bot: false, first_name: "Mohammad", username: "mohammad" },
    chat: { id: workspace, type: "supergroup", title: "LUMA ADHD" },
    date: 1_723_000_000,
  };
}

class FakeTransport implements TelegramTransport {
  readonly calls: TelegramSendTextInput[] = [];

  async sendTextMessage(input: TelegramSendTextInput): Promise<TelegramSentMessage> {
    this.calls.push(input);
    return { telegramMessageId: String(70_000 + this.calls.length), telegramChatId: input.telegramChatId };
  }
}

class SelectiveFailTransport extends FakeTransport {
  async sendTextMessage(input: TelegramSendTextInput): Promise<TelegramSentMessage> {
    if (input.botAlias === "finance") {
      throw new TelegramTransportError("permanent_rejection", "controlled projection failure");
    }
    return super.sendTextMessage(input);
  }
}

const unavailableCapabilities: AgentCapabilityManifest = {
  canSearchOwnFiles: true,
  canSearchSharedFiles: true,
  canUseOfficialLumaKnowledge: true,
  canRequestAgent: true,
  canRequestHuman: true,
  canCreateFiles: true,
  canCreateDiagram: true,
  visionModelSupported: true,
  currentImagePresent: false,
  currentImageFetchStatus: "not_present",
  currentImageDeliveredToModel: false,
  currentImageCount: 0,
};

describe("post-v1 Telegram multimodal and group truth", () => {
  it("normalizes text, photo-only, captioned photo, image document, and reply-to-photo metadata", () => {
    const photo = {
      file_id: "photo-file-large",
      file_unique_id: "photo-unique-large",
      width: 1200,
      height: 800,
      file_size: 4000,
    };
    const normalized = normalizeTelegramUpdate({
      update_id: 81_001,
      message: { ...baseMessage(81_001), photo: [
        { file_id: "photo-file-small", file_unique_id: "photo-unique-small", width: 320, height: 240 },
        photo,
      ] },
    });
    expect(normalized?.text).toBe("");
    expect(normalized?.attachment).toMatchObject({
      type: "image",
      source: "photo",
      telegramFileId: "photo-file-large",
      width: 1200,
      height: 800,
    });

    const captioned = normalizeTelegramUpdate({
      update_id: 81_002,
      message: { ...baseMessage(81_002), caption: "این چیست؟", photo: [photo] },
    });
    expect(captioned?.text).toBe("این چیست؟");
    expect(captioned?.attachment?.type).toBe("image");

    const document = normalizeTelegramUpdate({
      update_id: 81_003,
      message: {
        ...baseMessage(81_003),
        caption: "نمایش بده",
        document: {
          file_id: "document-file",
          file_unique_id: "document-unique",
          file_name: "screen.png",
          mime_type: "image/png",
          file_size: 1200,
        },
      },
    });
    expect(document?.attachment).toMatchObject({ type: "image", source: "document", fileName: "screen.png" });

    const reply = normalizeTelegramUpdate({
      update_id: 81_004,
      message: {
        ...baseMessage(81_004),
        text: "این چیه؟",
        reply_to_message: { ...baseMessage(81_003), photo: [photo] },
      },
    });
    expect(reply?.replyTo?.telegramMessageId).toBe("81003");
  });

  it("persists an image-only canonical message and creates one normal job", async () => {
    const app = createTelegramApplication({
      repositories,
      config: configWithRoster(),
      now: () => "2026-08-22T08:00:00.000Z",
    });
    const updateId = 81_101;
    const first = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-22T08:00:00.000Z",
      payload: {
        update_id: updateId,
        message: {
          ...baseMessage(updateId),
          photo: [{ file_id: "photo-persist", file_unique_id: "photo-persist-unique", width: 640, height: 480 }],
        },
      },
    });
    expect(first.status).toBe("accepted");
    const message = await repositories.messages.getById(first.messageId as string);
    expect(message.contentText).toBe("[image attachment]");
    expect(message.metadata.attachment).toMatchObject({ type: "image", telegramFileId: "photo-persist" });
    const second = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-22T08:00:01.000Z",
      payload: {
        update_id: updateId,
        message: {
          ...baseMessage(updateId),
          photo: [{ file_id: "photo-persist", file_unique_id: "photo-persist-unique", width: 640, height: 480 }],
        },
      },
    });
    expect(second.status).toBe("duplicate");
  });

  it("runs an authorized roll call once per active normal Agent without a model call", async () => {
    const transport = new FakeTransport();
    const app = createTelegramApplication({ repositories, config: configWithRoster(), transport, now: () => "2026-08-22T09:00:00.000Z" });
    const updateId = 81_201;
    const accepted = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-22T09:00:00.000Z",
      payload: {
        update_id: updateId,
        message: { ...baseMessage(updateId), text: "همه Agentهای فعال فقط اعلام حضور کنید." },
      },
    });
    expect(accepted.status).toBe("accepted");
    const job = await repositories.jobs.getById(accepted.jobId as string);
    expect(job.jobType).toBe("telegram.roll_call");
    const first = await app.runRollCall(job);
    expect(first.targetedAgentIds).toHaveLength(8);
    expect(first.respondedAgentIds).toHaveLength(8);
    expect(first.failedAgentIds).toHaveLength(0);
    expect(transport.calls).toHaveLength(8);
    expect(new Set(transport.calls.map((call) => call.botAlias)).size).toBe(8);
    expect(transport.calls.every((call) => call.replyToTelegramMessageId === String(updateId))).toBe(true);

    await app.runRollCall(job);
    expect(transport.calls).toHaveLength(8);
    const attendance = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE thread_id = ? AND json_extract(metadata_json, '$.interactionMode') = 'roll_call'")
      .bind(accepted.threadId)
      .first<{ count: number }>();
    expect(attendance?.count).toBe(8);
    const rollCallThread = await repositories.threads.getById(accepted.threadId as string);
    const groupRollCalls = await repositories.events.listRecentByTypeForChat(
      rollCallThread.chatId as string,
      "telegram.roll_call_completed",
      1,
    );
    expect(groupRollCalls[0]?.payload.respondedAgentIds).toHaveLength(8);
  });

  it("does not let an unauthorized user trigger a roll-call storm", async () => {
    const app = createTelegramApplication({ repositories, config: configWithRoster() });
    const updateId = 81_202;
    const result = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-22T09:05:00.000Z",
      payload: {
        update_id: updateId,
        message: { ...baseMessage(updateId), from: { id: 777, is_bot: false, first_name: "Guest" }, text: "همه اعلام حضور کنید" },
      },
    });
    expect(result).toEqual({ status: "ignored", reason: "roll_call_requires_authorized_human" });
  });

  it("excludes paused Agents and records a persona projection failure without fake attendance", async () => {
    const workspace = "-100200301";
    const transport = new SelectiveFailTransport();
    const app = createTelegramApplication({ repositories, config: configWithRoster(workspace), transport, now: () => "2026-08-22T12:00:00.000Z" });
    await repositories.agents.setActive("agent-heretic", false);
    try {
      const updateId = 81_203;
      const accepted = await app.ingest({
        botAlias: "gateway",
        receivedAt: "2026-08-22T12:00:00.000Z",
        payload: {
          update_id: updateId,
          message: { ...baseMessage(updateId, workspace), text: "Ù‡Ù…Ù‡ AgentÙ‡Ø§ÛŒ ÙØ¹Ø§Ù„ ÙÙ‚Ø· Ø§Ø¹Ù„Ø§Ù… Ø­Ø¶ÙˆØ± Ú©Ù†ÛŒØ¯" },
        },
      });
      const result = await app.runRollCall(await repositories.jobs.getById(accepted.jobId as string));
      expect(result.targetedAgentIds).toHaveLength(7);
      expect(result.targetedAgentIds).not.toContain("agent-heretic");
      expect(result.respondedAgentIds).toHaveLength(6);
      expect(result.failedAgentIds).toEqual(["agent-finance"]);
      expect(transport.calls).toHaveLength(6);
    } finally {
      await repositories.agents.setActive("agent-heretic", true);
    }
  });

  it("routes explicit all-Agent broadcast once per active Agent while ordinary group questions stay bounded", async () => {
    const transport = new FakeTransport();
    const app = createTelegramApplication({ repositories, config: configWithRoster(), transport, now: () => "2026-08-22T09:10:00.000Z" });
    const explicitId = 81_301;
    const explicit = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-22T09:10:00.000Z",
      payload: {
        update_id: explicitId,
        message: { ...baseMessage(explicitId), text: "همه هشت نفر نظرتون رو کوتاه بگید" },
      },
    });
    const explicitJob = await repositories.jobs.getById(explicit.jobId as string);
    expect(explicitJob.jobType).toBe("telegram.explicit_all_agents");
    const provider = new FakeProvider();
    const runtime = new AgentRuntimeService({
      repositories,
      provider,
      telegram: app,
      modelKey: "gpt-5.6-luna",
      now: () => "2026-08-22T09:10:01.000Z",
      rng: () => 0,
    });
    const result = await runtime.processJob(explicitJob);
    expect(result?.turns).toBe(8);
    expect(provider.calls).toHaveLength(8);
    const turns = await repositories.agentTurns.listByJob(explicitJob.id, 8);
    expect(new Set(turns.map((turn) => turn.agentId)).size).toBe(8);

    const ordinaryId = 81_302;
    const ordinary = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-22T09:20:00.000Z",
      payload: {
        update_id: ordinaryId,
        message: { ...baseMessage(ordinaryId), text: "بچه‌ها نظرتون درباره این تصمیم چیه؟" },
      },
    });
    const ordinaryJob = await repositories.jobs.getById(ordinary.jobId as string);
    expect(ordinaryJob.jobType).toBe("telegram.interactive_message");
  });

  it("rejects unsafe or oversized Telegram media and validates magic bytes", async () => {
    const config = parseTelegramConfig({
      TELEGRAM_GROUP_ID: groupId,
      TELEGRAM_WEBHOOK_SECRET: "test-secret",
      TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({ gateway: { username: "luma_gateway" } }),
      TELEGRAM_GATEWAY_BOT_TOKEN: "token-not-output",
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/getFile")) return new Response(JSON.stringify({ ok: true, result: { file_path: "photos/test.png" } }), { status: 200 });
      return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    };
    const media = new TelegramMediaFetcher({ config, fetcher, maxBytes: 1024 });
    const result = await media.fetchImage({ fileId: "file-id" });
    expect(result.status).toBe("available");
    expect(result.dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
    expect(result.dataUrl).not.toContain("token-not-output");

    const rejected = new TelegramMediaFetcher({
      config,
      fetcher: async (input) => {
        const url = String(input);
        if (url.endsWith("/getFile")) return new Response(JSON.stringify({ ok: true, result: { file_path: "https://evil.example/x" } }), { status: 200 });
        return new Response("", { status: 200 });
      },
      maxBytes: 1024,
    });
    await expect(rejected.fetchImage({ fileId: "file-id" })).resolves.toMatchObject({ status: "rejected", errorCategory: "file_path_rejected" });
    expect(calls.some((url) => url.includes("api.telegram.org/file/bot"))).toBe(true);
  });

  it("maps inline image data to OpenAI input_image without exposing Telegram URLs", async () => {
    let body: Record<string, unknown> | null = null;
    const provider = new OpenAIProvider({
      apiKey: "test-secret",
      maxAttempts: 1,
      fetcher: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: "resp-image",
          model: "gpt-5.6-luna",
          status: "completed",
          output_text: JSON.stringify({ intent: "WAIT", confidence: 0.5, reason_summary: "received", target_agent_id: null, target_thread_id: null, metadata: {} }),
        }), { status: 200 });
      },
    });
    await provider.generate({
      modelKey: "gpt-5.6-luna",
      systemPrompt: "capability truth",
      messages: [{ role: "user", content: [
        { type: "text", text: "این تصویر چیه؟" },
        { type: "image_data", dataUrl: "data:image/png;base64,iVBORw0KGgo=", detail: "auto" },
      ] }],
      reasoningEffort: "medium",
      structuredOutput: { name: "luma_agent_step", schema: { type: "object", additionalProperties: false } },
    });
    const input = (body?.input as Array<Record<string, unknown>>)[0];
    expect(input.content).toEqual([
      { type: "input_text", text: "این تصویر چیه؟" },
      { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=", detail: "auto" },
    ]);
    expect(JSON.stringify(body)).not.toContain("api.telegram.org/file/bot");
  });

  it("delivers a current Telegram image to the exact Luna turn and records capability truth", async () => {
    const app = createTelegramApplication({ repositories, config: configWithRoster(), now: () => "2026-08-22T10:00:00.000Z" });
    const updateId = 81_401;
    const accepted = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-22T10:00:00.000Z",
      payload: {
        update_id: updateId,
        message: {
          ...baseMessage(updateId),
          caption: "این تصویر چیه؟",
          photo: [{ file_id: "vision-file", file_unique_id: "vision-unique", width: 20, height: 20 }],
        },
      },
    });
    let providerBody: Record<string, unknown> | null = null;
    let providerCalls = 0;
    const provider = new OpenAIProvider({
      apiKey: "test-secret",
      maxAttempts: 1,
      fetcher: async (_input, init) => {
        providerCalls += 1;
        providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: "resp-runtime-image",
          model: "gpt-5.6-luna",
          status: "completed",
          output_text: JSON.stringify({
            intent: providerCalls === 1 ? "SPEAK" : "WAIT",
            content: providerCalls === 1 ? "تصویر یک شکل ساده است." : null,
            confidence: 0.8,
            reason_summary: providerCalls === 1 ? "تصویر در همین نوبت تحویل شد." : "تکرار لازم نیست.",
            target_agent_id: null,
            target_thread_id: null,
            metadata: {},
          }),
        }), { status: 200 });
      },
    });
    const mediaConfig = parseTelegramConfig({
      TELEGRAM_GROUP_ID: groupId,
      TELEGRAM_WEBHOOK_SECRET: "test-secret",
      TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({ gateway: { username: "luma_gateway" } }),
      TELEGRAM_GATEWAY_BOT_TOKEN: "internal-token",
    });
    const media = new TelegramMediaFetcher({
      config: mediaConfig,
      fetcher: async (input) => String(input).endsWith("/getFile")
        ? new Response(JSON.stringify({ ok: true, result: { file_path: "photos/vision.png" } }), { status: 200 })
        : new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { status: 200 }),
    });
    const runtime = new AgentRuntimeService({
      repositories,
      provider,
      media,
      modelKey: "gpt-5.6-luna",
      reasoningEffort: "medium",
      now: () => "2026-08-22T10:00:01.000Z",
      rng: () => 0,
    });
    const result = await runtime.processJob(await repositories.jobs.getById(accepted.jobId as string));
    expect(result?.publicMessages).toBe(1);
    const input = (providerBody?.input as Array<Record<string, unknown>>)[0];
    expect(JSON.stringify(input)).toContain('"type":"input_image"');
    const turn = (await repositories.agentTurns.listByJob(accepted.jobId as string, 1))[0];
    expect(turn?.metadata.capabilities).toMatchObject({
      attachmentPresent: true,
      imageDeliveredToModel: true,
      imageFetchStatus: "available",
      imageCount: 1,
    });
  });

  it("guards false image-capability claims when this turn did not receive an image", () => {
    const result = enforceVisionCapabilityTruth({
      content: "بله، عکس را می‌بینم و بررسی می‌کنم.",
      humanQuery: "عکس هم میتونین ببینین؟",
      capabilities: unavailableCapabilities,
    });
    expect(result.guarded).toBe(true);
    const truthful = enforceVisionCapabilityTruth({
      content: "I cannot see the image in this turn.",
      humanQuery: "Can you see the image?",
      capabilities: unavailableCapabilities,
    });
    expect(truthful.guarded).toBe(false);
    expect(result.content).not.toContain("می‌بینم");
  });
});
