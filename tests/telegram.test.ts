import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createRepositories } from "../src/database";
import { splitTelegramMessage } from "../src/guardrails";
import {
  createTelegramApplication,
  parseTelegramConfig,
  renderTelegramText,
  TelegramBotApiTransport,
} from "../src/telegram";
import {
  TelegramTransportError,
  type TelegramSendTextInput,
  type TelegramSentMessage,
  type TelegramTransport,
} from "../src/telegram";
import { handleTelegramWebhook, type TelegramRuntimeEnv } from "../src/telegram/webhook";

const repositories = createRepositories(env.DB);
const groupId = "-100200300";

function fakeConfig() {
  return parseTelegramConfig({
    TELEGRAM_GROUP_ID: groupId,
    TELEGRAM_ADMIN_USER_IDS: "42",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({
      gateway: { telegramUserId: "9000", username: "luma_gateway" },
      product: { telegramUserId: "9001", username: "luma_product" },
    }),
  });
}

function telegramUpdate(
  updateId: number,
  messageId: number,
  text: string,
  options?: {
    readonly chatId?: string;
    readonly senderId?: number;
    readonly replyTo?: Record<string, unknown>;
  },
): Record<string, unknown> {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      from: {
        id: options?.senderId ?? 42,
        is_bot: false,
        first_name: "Mohammad",
        username: "mohammad",
      },
      chat: {
        id: options?.chatId ?? groupId,
        type: "supergroup",
        title: "LUMA ADHD",
      },
      date: 1_723_000_000,
      text,
      ...(options?.replyTo ? { reply_to_message: options.replyTo } : {}),
    },
  };
}

function personaReply(messageId: number): Record<string, unknown> {
  return {
    message_id: messageId,
    from: {
      id: 9001,
      is_bot: true,
      first_name: "Product",
      username: "luma_product",
    },
    chat: { id: groupId, type: "supergroup", title: "LUMA ADHD" },
    date: 1_723_000_001,
    text: "A product response",
  };
}

class FakeTelegramTransport implements TelegramTransport {
  readonly calls: TelegramSendTextInput[] = [];
  failure: TelegramTransportError | null = null;

  async sendTextMessage(input: TelegramSendTextInput): Promise<TelegramSentMessage> {
    this.calls.push(input);
    if (this.failure !== null) {
      const failure = this.failure;
      this.failure = null;
      throw failure;
    }

    return {
      telegramMessageId: String(50_000 + this.calls.length),
      telegramChatId: input.telegramChatId,
    };
  }
}

function application(transport?: TelegramTransport) {
  return createTelegramApplication({
    repositories,
    config: fakeConfig(),
    transport,
    now: () => "2026-08-14T08:00:00.000Z",
  });
}

describe("Phase 02 Telegram ingress", () => {
  it("creates one canonical human message and one coarse interactive job", async () => {
    const result = await application().ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-14T08:00:00.000Z",
      payload: telegramUpdate(20_001, 30_001, "What should LUMA test first?"),
    });

    expect(result.status).toBe("accepted");
    expect(result.messageId).toBeDefined();
    expect(result.jobId).toBeDefined();

    const messages = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE telegram_update_id = ?")
      .bind("20001")
      .first<{ count: number }>();
    const jobs = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE idempotency_key = ?")
      .bind("telegram-interactive:gateway:20001")
      .first<{ count: number }>();
    expect(messages?.count).toBe(1);
    expect(jobs?.count).toBe(1);
  });

  it("does not duplicate a replayed Telegram update", async () => {
    const payload = telegramUpdate(20_002, 30_002, "This update may arrive twice.");
    const first = await application().ingest({ botAlias: "gateway", receivedAt: "2026-08-14T08:00:00.000Z", payload });
    const second = await application().ingest({ botAlias: "gateway", receivedAt: "2026-08-14T08:00:01.000Z", payload });

    expect(first.status).toBe("accepted");
    expect(second.status).toBe("duplicate");
    expect(second.messageId).toBe(first.messageId);
    expect(second.threadId).toBe(first.threadId);

    const messageCount = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE telegram_update_id = ?")
      .bind("20002")
      .first<{ count: number }>();
    const jobCount = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE idempotency_key = ?")
      .bind("telegram-interactive:gateway:20002")
      .first<{ count: number }>();
    expect(messageCount?.count).toBe(1);
    expect(jobCount?.count).toBe(1);
  });

  it("maps a human reply to the correct persona and existing thread", async () => {
    const transport = new FakeTelegramTransport();
    const app = application(transport);
    const initial = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-14T08:00:00.000Z",
      payload: telegramUpdate(20_003, 30_003, "Can product narrow this down?"),
    });
    const chat = await repositories.chats.findByTelegramId(groupId);
    expect(chat).not.toBeNull();

    const response = await app.projectAgentMessage({
      threadId: initial.threadId as string,
      chatId: chat!.id,
      agentId: "agent-product",
      contentText: "Yes. Test the smallest user-visible hypothesis first.",
      idempotencyKey: "reply-map-20003",
    });
    expect(response.status).toBe("sent");
    expect(response.telegramMessageIds).toHaveLength(1);

    const followUp = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-14T08:00:02.000Z",
      payload: telegramUpdate(20_004, 30_004, "Do that next.", {
        replyTo: personaReply(Number(response.telegramMessageIds[0])),
      }),
    });

    expect(followUp.status).toBe("accepted");
    expect(followUp.threadId).toBe(initial.threadId);
    expect(followUp.addressedAgentId).toBe("agent-product");
    const followUpMessage = await repositories.messages.getById(followUp.messageId as string);
    expect(followUpMessage.replyToMessageId).toBe(response.messageId);
  });

  it("ignores messages from an unauthorized chat without creating a job", async () => {
    const result = await application().ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-14T08:00:00.000Z",
      payload: telegramUpdate(20_005, 30_005, "Wrong workspace", { chatId: "-100999" }),
    });

    expect(result).toEqual({ status: "ignored", reason: "chat_not_configured" });
    const jobs = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE idempotency_key = ?")
      .bind("telegram-interactive:gateway:20005")
      .first<{ count: number }>();
    expect(jobs?.count).toBe(0);
  });

  it("fails explicitly when webhook configuration is incomplete", async () => {
    const incomplete = parseTelegramConfig({
      TELEGRAM_GROUP_ID: "",
      TELEGRAM_WEBHOOK_SECRET: "",
      TELEGRAM_BOT_IDENTITIES_JSON: "{}",
    });
    const app = createTelegramApplication({ repositories, config: incomplete });

    await expect(
      app.ingest({
        botAlias: "gateway",
        receivedAt: "2026-08-14T08:00:00.000Z",
        payload: telegramUpdate(20_006, 30_006, "Not configured"),
      }),
    ).rejects.toThrow("TELEGRAM_GROUP_ID and TELEGRAM_WEBHOOK_SECRET are required");
  });

  it("fails closed when a plain-text deployment strips JSON identity quotes", async () => {
    const response = await handleTelegramWebhook(
      new Request("https://luma.example/telegram/webhook/gateway", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
      {
        DB: env.DB,
        TELEGRAM_GROUP_ID: groupId,
        TELEGRAM_ADMIN_USER_IDS: "42",
        TELEGRAM_WEBHOOK_SECRET: "test-secret",
        TELEGRAM_BOT_IDENTITIES_JSON:
          "{gateway:{telegramUserId:9000,username:luma_gateway}}",
      } satisfies TelegramRuntimeEnv,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "telegram_configuration_invalid",
    });
  });
});

describe("Phase 02 Telegram outbound projection", () => {
  it("escapes ordinary text and preserves markup only for explicit HTML projections", () => {
    const markup = "<b>Bold</b> & <i>italic</i>";

    expect(renderTelegramText(markup)).toEqual([
      "&lt;b&gt;Bold&lt;/b&gt; &amp; &lt;i&gt;italic&lt;/i&gt;",
    ]);
    expect(renderTelegramText(markup, "telegram_html")).toEqual(["<b>Bold</b> &amp; <i>italic</i>"]);
  });

  it("bolds only the exact participant name in Persian direct address", () => {
    const address = "<b>سارا</b>، پیشنهادت درباره آنبوردینگ خوبه، ولی یک ریسک داریم.";

    expect(renderTelegramText(address, "telegram_html")).toEqual([address]);
    expect(renderTelegramText(address, "telegram_html")[0]).not.toContain(
      "<b>سارا، پیشنهادت",
    );
  });

  it("keeps agent-to-agent address, bullets, ordered steps, and metrics scannable", () => {
    const proposal = [
      "<b>رادین</b>، از دید رشد یک فرض مهم هنوز بررسی نشده.",
      "",
      "<b>پیشنهاد من:</b>",
      "• یک تست با کاربران جدید",
      "• اندازه‌گیری نرخ فعال‌سازی (<code>Activation Rate</code>)",
      "",
      "1. نسخه کوتاه را اجرا کنیم.",
      "2. نتیجه را با نسخه فعلی مقایسه کنیم.",
    ].join("\n");

    expect(renderTelegramText(proposal, "telegram_html")).toEqual([proposal]);
    expect(proposal.indexOf("1. ")).toBeLessThan(proposal.indexOf("2. "));
    expect(proposal).not.toContain("1️⃣");
  });

  it("does not add a blockquote merely because content is a reply", () => {
    const contribution = "<b>رادین</b>، برای این فرضیه یک تست کوچک کافی است.";

    expect(renderTelegramText(contribution, "telegram_html")[0]).not.toContain("<blockquote>");
  });

  it("sanitizes unsupported or malformed HTML and removes Markdown leakage", () => {
    expect(renderTelegramText("<script>alert(1)</script> **bold**\n### عنوان", "telegram_html"))
      .toEqual(["alert(1) bold\nعنوان"]);
    expect(renderTelegramText("<b>بدون پایان", "telegram_html")).toEqual(["بدون پایان"]);
    expect(renderTelegramText("ordinary text without formatting", "telegram_html"))
      .toEqual(["ordinary text without formatting"]);
  });

  it("keeps HTML tags balanced when a long formatted message is split", () => {
    const content = `<b>${"آ".repeat(4_200)}</b>`;
    const parts = renderTelegramText(content, "telegram_html");

    expect(parts.length).toBe(2);
    expect(parts[0]?.startsWith("<b>")).toBe(true);
    expect(parts[0]?.endsWith("</b>")).toBe(true);
    expect(parts[1]?.startsWith("<b>")).toBe(true);
    expect(parts[1]?.endsWith("</b>")).toBe(true);
    expect(parts.every((part) => Array.from(part).length <= 4096)).toBe(true);
  });

  it("keeps Telegram HTTP behavior inside the adapter and normalizes success", async () => {
    let requestBody = "";
    const config = parseTelegramConfig({
      TELEGRAM_GROUP_ID: groupId,
      TELEGRAM_WEBHOOK_SECRET: "test-secret",
      TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({ product: { username: "luma_product" } }),
      TELEGRAM_PRODUCT_BOT_TOKEN: "placeholder-token",
    });
    const transport = new TelegramBotApiTransport(config, async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        ok: true,
        result: { message_id: 60_001, chat: { id: groupId } },
      }), { status: 200 });
    });

    const sent = await transport.sendTextMessage({
      botAlias: "product",
      telegramChatId: groupId,
      text: "safe &amp; escaped",
      replyToTelegramMessageId: "59",
    });

    expect(sent).toEqual({ telegramMessageId: "60001", telegramChatId: groupId });
    expect(JSON.parse(requestBody)).toMatchObject({
      chat_id: groupId,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: "59" },
    });
  });

  it("forwards an explicit HTML projection through the canonical outbound mapping", async () => {
    const transport = new FakeTelegramTransport();
    const app = application(transport);
    const inbound = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-14T08:00:00.000Z",
      payload: telegramUpdate(20_010, 30_010, "Validate rich output."),
    });
    const chat = await repositories.chats.findByTelegramId(groupId);
    expect(chat).not.toBeNull();
    const markup = "<b>Radin formatting test</b>";

    const result = await app.projectAgentMessage({
      threadId: inbound.threadId as string,
      chatId: chat!.id,
      agentId: "agent-product",
      contentText: markup,
      contentFormat: "telegram_html",
      idempotencyKey: "outbound-html-20010",
      metadata: { source: "phase02_local_formatting_smoke" },
    });
    const outbound = await repositories.telegramOutbound.getByIdempotencyKey("outbound-html-20010");

    expect(result.status).toBe("sent");
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.text).toBe(markup);
    expect(outbound.payload).toMatchObject({ parseMode: "HTML", contentFormat: "telegram_html" });
  });

  it("binds the Worker fetch receiver before invoking Telegram HTTP", async () => {
    let receiver: unknown;
    const config = parseTelegramConfig({
      TELEGRAM_GROUP_ID: groupId,
      TELEGRAM_WEBHOOK_SECRET: "test-secret",
      TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({ product: { username: "luma_product" } }),
      TELEGRAM_PRODUCT_BOT_TOKEN: "placeholder-token",
    });
    const receiverSensitiveFetch = function (this: unknown): Promise<Response> {
      receiver = this;
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        result: { message_id: 60_002, chat: { id: groupId } },
      }), { status: 200 }));
    } as typeof fetch;

    const transport = new TelegramBotApiTransport(config, receiverSensitiveFetch);
    await transport.sendTextMessage({
      botAlias: "product",
      telegramChatId: groupId,
      text: "receiver-safe",
    });

    expect(receiver).toBe(globalThis);
  });

  it("selects the persona, records one outbound mapping, and is idempotent", async () => {
    const transport = new FakeTelegramTransport();
    const app = application(transport);
    const inbound = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-14T08:00:00.000Z",
      payload: telegramUpdate(20_007, 30_007, "Create a product reply."),
    });
    const chat = await repositories.chats.findByTelegramId(groupId);
    expect(chat).not.toBeNull();

    const first = await app.projectAgentMessage({
      threadId: inbound.threadId as string,
      chatId: chat!.id,
      agentId: "agent-product",
      contentText: "A canonical response projected through the product persona.",
      idempotencyKey: "outbound-idempotency-20007",
    });
    const second = await app.projectAgentMessage({
      threadId: inbound.threadId as string,
      chatId: chat!.id,
      agentId: "agent-product",
      contentText: "A canonical response projected through the product persona.",
      idempotencyKey: "outbound-idempotency-20007",
    });

    expect(first.status).toBe("sent");
    expect(second.status).toBe("already_sent");
    expect(transport.calls).toHaveLength(1);
    const outbound = await repositories.telegramOutbound.getByIdempotencyKey("outbound-idempotency-20007");
    const parts = await repositories.telegramOutbound.listParts(outbound.id);
    expect(outbound.botAlias).toBe("product");
    expect(outbound.status).toBe("sent");
    expect(parts).toHaveLength(1);
    expect(parts[0]?.telegramMessageId).toBe(first.telegramMessageIds[0]);
    const canonical = await repositories.messages.getById(first.messageId);
    expect(canonical.telegramMessageId).toBe(first.telegramMessageIds[0]);
    expect(canonical.telegramBotAlias).toBe("product");
  });

  it("preserves cross-persona reply relationships internally without sending an invalid Telegram reply target", async () => {
    const transport = new FakeTelegramTransport();
    const app = createTelegramApplication({
      repositories,
      config: parseTelegramConfig({
        TELEGRAM_GROUP_ID: groupId,
        TELEGRAM_ADMIN_USER_IDS: "42",
        TELEGRAM_WEBHOOK_SECRET: "test-secret",
        TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({
          gateway: { telegramUserId: "9000", username: "luma_gateway" },
          product: { telegramUserId: "9001", username: "luma_product" },
          customer: { telegramUserId: "9002", username: "luma_customer" },
        }),
      }),
      transport,
      now: () => "2026-08-14T08:00:00.000Z",
    });
    const inbound = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-14T08:00:00.000Z",
      payload: telegramUpdate(20_010, 30_010, "Keep the internal reply chain."),
    });
    const chat = await repositories.chats.findByTelegramId(groupId);
    expect(chat).not.toBeNull();

    const product = await app.projectAgentMessage({
      threadId: inbound.threadId as string,
      chatId: chat!.id,
      agentId: "agent-product",
      contentText: "The product perspective.",
      idempotencyKey: "cross-persona-product-20010",
    });
    const customer = await app.projectAgentMessage({
      threadId: inbound.threadId as string,
      chatId: chat!.id,
      agentId: "agent-customer",
      contentText: "The customer perspective builds on it.",
      replyToMessageId: product.messageId,
      idempotencyKey: "cross-persona-customer-20010",
    });

    expect(customer.status).toBe("sent");
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.replyToTelegramMessageId).toBeUndefined();
    const canonical = await repositories.messages.getById(customer.messageId);
    expect(canonical.replyToMessageId).toBe(product.messageId);
    const outbound = await repositories.telegramOutbound.getByIdempotencyKey("cross-persona-customer-20010");
    const parts = await repositories.telegramOutbound.listParts(outbound.id);
    expect(parts[0]?.replyToTelegramMessageId).toBeNull();
  });

  it("keeps canonical output when Telegram fails and records bounded retry data", async () => {
    const transport = new FakeTelegramTransport();
    transport.failure = new TelegramTransportError("rate_limited", "rate limited by Telegram", {
      retryAfterSeconds: 7,
      errorCode: 429,
    });
    const app = application(transport);
    const inbound = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-14T08:00:00.000Z",
      payload: telegramUpdate(20_008, 30_008, "Create a response that will fail delivery."),
    });
    const chat = await repositories.chats.findByTelegramId(groupId);
    expect(chat).not.toBeNull();

    const result = await app.projectAgentMessage({
      threadId: inbound.threadId as string,
      chatId: chat!.id,
      agentId: "agent-product",
      contentText: "This remains canonical even if delivery fails.",
      idempotencyKey: "outbound-failure-20008",
    });
    const outbound = await repositories.telegramOutbound.getByIdempotencyKey("outbound-failure-20008");
    const canonical = await repositories.messages.getById(result.messageId);

    expect(result.status).toBe("retry_scheduled");
    expect(transport.calls).toHaveLength(1);
    expect(canonical.contentText).toContain("remains canonical");
    expect(canonical.telegramMessageId).toBeNull();
    expect(outbound.status).toBe("failed");
    expect(outbound.attemptCount).toBe(1);
    expect(outbound.nextAttemptAt).toBe("2026-08-14T08:00:07.000Z");
    expect(outbound.lastError).toContain('"kind":"rate_limited"');
  });

  it("splits long Unicode text without breaking code points or ordering", () => {
    const message = `${"🧠".repeat(4097)} پایان`;
    const chunks = splitTelegramMessage(message);

    expect(chunks.length).toBe(2);
    expect(chunks.join("")).toBe(message);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 4096)).toBe(true);
  });

  it("records every Telegram part and chains long projections in order", async () => {
    const transport = new FakeTelegramTransport();
    const app = application(transport);
    const inbound = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-14T08:00:00.000Z",
      payload: telegramUpdate(20_009, 30_009, "Project a long response."),
    });
    const chat = await repositories.chats.findByTelegramId(groupId);
    expect(chat).not.toBeNull();
    const content = "🧠".repeat(4097);

    const result = await app.projectAgentMessage({
      threadId: inbound.threadId as string,
      chatId: chat!.id,
      agentId: "agent-product",
      contentText: content,
      idempotencyKey: "outbound-long-20009",
    });
    const outbound = await repositories.telegramOutbound.getByIdempotencyKey("outbound-long-20009");
    const parts = await repositories.telegramOutbound.listParts(outbound.id);

    expect(result.status).toBe("sent");
    expect(transport.calls).toHaveLength(2);
    expect(parts.map((part) => part.text).join("")).toBe(content);
    expect(parts[1]?.replyToTelegramMessageId).toBe(result.telegramMessageIds[0]);
    expect(parts.every((part) => part.telegramMessageId !== null)).toBe(true);
  });
});

describe("Phase 02 webhook boundary", () => {
  it("checks the Telegram secret before parsing the request body", async () => {
    const runtimeEnv: TelegramRuntimeEnv = {
      DB: env.DB,
      TELEGRAM_GROUP_ID: groupId,
      TELEGRAM_ADMIN_USER_IDS: "42",
      TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({ gateway: { username: "luma_gateway" } }),
      TELEGRAM_WEBHOOK_SECRET: "test-secret",
    };
    const response = await handleTelegramWebhook(
      new Request("https://luma.example/telegram/webhook/gateway", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong-secret" },
        body: "not-json",
      }),
      runtimeEnv,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
  });
});
