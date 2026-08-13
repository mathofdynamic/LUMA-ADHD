# Telegram Architecture for a Multi-Agent AI Workspace (LUMA ADHD)

## 1. Updated Telegram Bot Constraints (Aug 2026)

### 1.1 Bots seeing messages from other bots

Telegram’s historical rule was that bots could not see messages from other bots to avoid infinite loops.[web:12] Recent platform updates introduced **Bot-to-Bot Communication Mode**, which explicitly allows bot messages to be delivered to other bots under controlled conditions.[web:7][web:8]

Key points as of mid‑2026:

- By default, bots **do not see** messages sent by other bots in groups.[web:12]
- With **Bot-to-Bot Communication Mode enabled** (via @BotFather) and appropriate group settings,, bots can receive messages from other bots when:[web:8]
  - The bot is explicitly addressed with a command mention `/cmd@TargetBot`, or
  - The message is a direct reply to one of its messages.
- A bot with Bot-to-Bot Mode enabled can also receive **all messages from other bots in a group** if it either:[web:8]
  - Is a group admin, or
  - Has Group Privacy Mode disabled.

This means your previous hard constraint (“bots cannot receive messages sent by other bots”) is now *configurable* rather than absolute, but only if you deliberately enable Bot-to-Bot mode for the relevant bots.[web:7][web:8]

### 1.2 What every bot always receives

Independent of privacy and bot‑to‑bot settings, Telegram guarantees:[web:12][web:18]

- All service messages (joins, leaves, pinned messages, etc.).
- All messages from private chats with users.
- All messages from channels where the bot is a member.

These always arrive as `update` objects via webhook or long polling.[web:15][web:18]


## 2. Group Behavior: What Each Bot Sees

### 2.1 Privacy mode ON (default)

With **Group Privacy Mode enabled** (the default when a bot is created):[web:10][web:9][web:18]

A bot in a group receives:

- Messages that start with `/` and explicitly reference it (e.g. `/help@my_bot`).[web:10][web:18]
- General commands like `/start` **if** it was the last bot that wrote in the group.[web:12][web:18]
- Replies to its own messages (even if they don’t start with `/`).[web:10][web:18]
- Messages sent *via* the bot (e.g. via inline mode in other chats).[web:12]
- Service messages in the group.[web:10]

Crucially, privacy‑mode bots **do not receive arbitrary free‑text messages** in the group, and only one privacy‑enabled bot can receive a given message: replies have priority, then explicit commands, then “last bot that spoke” semantics.[web:12][web:18]

### 2.2 Privacy mode OFF or bot is group admin

If **Group Privacy Mode is disabled** via `/setprivacy` in @BotFather *and the bot is re‑added to the group afterward*, the bot receives **all group messages**, except for messages from other bots unless Bot‑to‑Bot mode applies.[web:10][web:9][web:14]

Separately, when a bot is promoted to **group admin**, it also receives all group messages regardless of the privacy setting.[web:9][web:14][web:19]

Summary for visibility:

| Bot type | Privacy | Admin | Sees human group messages? | Sees bot messages? |
|---------|---------|-------|----------------------------|--------------------|
| Gateway/controller | ON/OFF | Yes | All | Only with Bot-to-Bot mode + conditions[web:8][web:7] |
| Persona | ON | No | Commands, mentions, replies, service[web:10][web:18] | No (unless Bot-to-Bot conditions) |
| Persona | OFF | No | All | No (unless Bot-to-Bot conditions) |

### 2.3 Messages from other bots (group context)

By default, group messages sent by bots are not delivered to other bots.[web:12] With **Bot‑to‑Bot Communication Mode**:[web:8][web:7]

- A bot receives another bot’s message if:
  - The message contains a command addressed to it (e.g. `/ask@analysis_bot`).
  - The message is a direct reply to one of its messages.
- If the receiving bot has Bot‑to‑Bot mode enabled and is either a group admin or has privacy disabled, it may receive all bot messages in that group as normal updates.

For a multi‑bot AI workspace, this means you *can* have a controller bot see what the persona bots are posting, provided you enable Bot‑to‑Bot mode and make it admin or disable its privacy mode.[web:7][web:8]

### 2.4 Message types and updates

All of the above rules govern when Telegram sends updates containing:[web:15][web:49]

- `update.message` for new messages in chats.
- `update.edited_message` for edits.
- `update.callback_query` for button presses.

Your Cloudflare Worker must parse different `update` variants but the visibility rules (privacy, bot‑to‑bot, admin) decide *which* updates arrive per bot.[web:15][web:49]


## 3. Recommended Visibility Setup for LUMA ADHD

### 3.1 Canonical gateway / controller bot

For a multi‑agent organization exposed through many Telegram personas, use **one primary “gateway/controller” bot** as the canonical input/output surface:

- Make the gateway bot a **group admin** so it sees every human message and all relevant service messages.[web:9][web:14][web:19]
- Enable **Bot‑to‑Bot Communication Mode** for the gateway and each persona bot so the gateway can see persona posts (or, alternatively, route persona messages internally without Telegram bot‑to‑bot).[web:8]
- Keep persona bots in **privacy mode ON**, receiving only explicit commands, mentions, and replies, which keeps their webhook volume lower and simplifies logic.[web:10][web:18]

This gives you a single authoritative stream of group activity inside Cloudflare while still rendering multiple distinct bot identities in the UI.

### 3.2 Persona bots as projection layers

Each AI personality (e.g. `@LumaPlannerBot`, `@LumaCriticBot`, `@LumaSummarizerBot`) should have its own bot token and avatar, but no independent “brain”:

- Each persona bot’s webhook points to the same Cloudflare Worker as the gateway.[web:49][web:50]
- The Worker tags incoming updates by `bot_token` and routes all logic to a central multi‑agent engine.
- Outbound messages for each agent are rendered by calling Telegram’s API with that persona’s bot token (identity) but share a single internal conversation model.

You effectively treat Telegram as a **multi‑skin terminal** for one LUMA ADHD workspace.


## 4. Internal Canonical Conversation Model

### 4.1 Core entities

Design the internal conversation as a platform‑agnostic structure:[web:15][web:49]

- `User`: Telegram user (`from.id`), with optional mapping to an internal user profile.
- `Chat`: Telegram group or private chat (`chat.id`), plus metadata (title, type, language).
- `Agent`: internal AI personality (e.g. `planner`, `critic`, `summarizer`) mapped to Telegram bot tokens and display names.
- `Message`: internal message record with:
  - `id` (UUID),
  - `chat_id` (internal),
  - `user_id` or `agent_id`,
  - `origin` (telegram / system / external),
  - `telegram_message_id` and `telegram_bot_id` for projection mapping.
- `Thread`: conversational sub‑topic or task, mapped loosely to reply chains and/or Telegram topics.

This lets you persist a clean multi‑agent log independent of Telegram’s quirks.

### 4.2 Mapping Telegram updates to the internal model

On each incoming update in the Cloudflare Worker:[web:15][web:49]

1. **Identify scope**
   - Determine `bot_token` (via webhook endpoint or secret mapping).
   - Parse `update.message` or `update.callback_query`.

2. **Normalize sender**
   - Map `message.from.id` to an internal `User` record; create if missing.
   - Store `is_bot` flag to distinguish humans from Telegram bots.

3. **Normalize chat**
   - Map `message.chat.id` to an internal `Chat` record.
   - Track whether this is the designated LUMA ADHD workspace group.

4. **Determine addressed agent**
   - For human messages:
     - If replying to a bot message: map `reply_to_message.from.id` to the persona’s internal `Agent`.[web:12][web:18]
     - If mentioning `@BotName`: parse mention to select an agent.
     - Otherwise, treat as addressed to the **gateway agent** by default.
   - For persona messages: `from.id` is one of your bot IDs; use that to map to the agent.

5. **Create internal message**
   - Persist the message with `telegram_message_id`, `chat_id`, `user_id`/`agent_id`, `text`, attachments, and `reply_to_internal_message_id` (mapped via a lookup on `reply_to_message.message_id`).

This produces a canonical conversation graph which your AI organization can reason over regardless of which Telegram persona fronted each message.

### 4.3 Threading and reply chains

Use Telegram reply information as *hints* for thread assignment:[web:15]

- If `message.reply_to_message` is present, attach the new message to the same `Thread` as the replied‑to internal message.
- If no reply but the message contains explicit `#tag` or command semantics (`/task`, `/god`, `/vote`), create or switch threads accordingly.
- Optionally map Telegram **topics** (threaded sub‑chats in supergroups) to internal threads for coarse partitioning.

This preserves conversational structure even when participants mix commands, free text, and multi‑agent voices.


## 5. Telegram Webhook Architecture on Cloudflare

### 5.1 Single Worker, multiple bots

Deploy a single Cloudflare Worker that serves as the webhook endpoint for all LUMA ADHD bots:[web:42][web:49][web:50]

- For each bot token, call `setWebhook` with the Worker URL plus a distinct path or query (e.g. `/tg-webhook/<bot_id>` or `?bot=<alias>`).
- Store a mapping of path/query → bot token and internal agent in the Worker’s environment (KV or static config).
- Within the Worker, authenticate the request via Telegram’s **secret token** header before reading the body.[web:42][web:28][web:26]

Example `setWebhook` call with secret token:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook" \
  -d "url=https://tg.luma.workers.dev/tg-webhook/gateway" \
  -d "secret_token=<RANDOM_SECRET>"
```

Telegram will then include `X-Telegram-Bot-Api-Secret-Token: <RANDOM_SECRET>` in every POST to that webhook endpoint.[web:27][web:28][web:42]

### 5.2 Request validation and spoofing protection

Best practices for securing the webhook Worker:[web:31][web:33][web:26]

- Validate `X-Telegram-Bot-Api-Secret-Token` **before** reading the request body to avoid resource‑exhaustion issues seen in other Telegram webhook stacks.
- Reject requests with missing or mismatched secret tokens using HTTP 401/403.
- Optionally check the `User-Agent` prefix `TelegramBot` and TLS SNI, but secret_token is the primary defense.
- Do not leak bot tokens in URLs or logs; keep them in Worker environment variables.

Because Telegram’s IPs can change and are sometimes proxied, secret token validation is more robust than IP whitelisting alone.[web:27][web:28]

### 5.3 Outbound Telegram API calls via Worker

For outbound calls (`sendMessage`, `sendPhoto`, `sendDocument`, etc.):[web:15][web:39][web:44]

- Either call Telegram’s Bot API directly from the Worker (`https://api.telegram.org/bot<TOKEN>/METHOD`) or via a **reverse‑proxy Worker** you control, which is useful in blocked regions like Iran.
- Store each bot’s token in environment variables (e.g. `BOT_GATEWAY_TOKEN`, `BOT_PLANNER_TOKEN`) and choose one based on the internal agent you’re projecting.

You can reuse the same Worker or a second “API proxy” Worker; either way, keep token handling server‑side only.[web:39][web:44][web:47]


## 6. Telegram Bot API Rate Limits and Strategy

### 6.1 Official and de‑facto limits

Telegram’s documented and widely observed Bot API limits as of 2025–2026 include:[web:21][web:17][web:16][web:20]

- ~1 message per second per individual chat (user, group, or channel).
- Up to ~20 messages per minute to the same group or channel.
- Up to ~30 messages per second globally across different chats for a given bot token.
- `429 Too Many Requests` responses contain a `parameters.retry_after` value in the JSON body indicating the delay in seconds before retry.
- Rate limits are applied **per bot token**, *not* per server or IP; separate bot accounts each have their own independent quota.

In 2024–2025, Telegram evolved these into a more dynamic token‑bucket model; `retry_after` can be fractional and depends on recent load.[web:35][web:20]

### 6.2 Implications for a multi‑agent group

For LUMA ADHD’s workspace group with 8–15 bots:

- Each persona bot has its own per‑chat (group) cap of ~20 messages per minute, but **the group itself** becomes noisy well before you hit that.[web:17][web:21]
- A burst of messages from many bots at once can still be rate‑limited per bot or per group; you must centralize sending logic in the Cloudflare backend to smooth bursts.[web:11][web:17][web:16]
- Bots share their own global 30 msg/sec cap across all chats; multiple LUMA bots avoid global contention because each token is independent.[web:21][web:16]

### 6.3 Handling 429s and retries

When Telegram returns HTTP 429 with a `retry_after` hint:[web:17][web:35][web:20][web:34]

- Treat it as a **hard stop** for the affected scope (chat or bot token).
- Pause sending to that chat for at least `retry_after + jitter` seconds.
- Retry the *same* request after the delay; Telegram assumes failed calls did not send messages.
- Instrument 429 rates; keep them below ~0.1% of calls for a smooth experience.

In Cloudflare Workers, implement per‑scope token buckets (per `chat_id`, and a global per `bot_token`) in Durable Objects or KV+memory to smooth dispatch.[web:17][web:20]


## 7. Content Types and UI Surface

### 7.1 Text and Markdown

Telegram’s Bot API `sendMessage` supports HTML and Markdown/MarkdownV2 formatting.[web:15]

For a multi‑agent workspace:

- Prefer **MarkdownV2** or HTML carefully, escaping reserved characters.
- Use consistent patterns to expose status:
  - `**Status:** ⏳ Draft`, `✅ Concluded`, `🧠 GOD override`, etc.
  - Keep these concise to avoid clutter.
- For long content, split messages to stay under Telegram’s text length limit (~4096 characters per message).

### 7.2 Files, diagrams, and images

Bots can send general files via `sendDocument` and images via `sendPhoto`:[web:22][web:24][web:15]

- Direct upload is limited to ~50 MB per file via the public Bot API; larger files require a self‑hosted Bot API server.
- When a file is uploaded once, the resulting `Message` includes a `file_id` which can be reused to send the same file again without re‑upload.
- `file_id` reuse is **per bot**: a `file_id` created by one bot cannot be used by a different bot.
- Thumbnails cannot be reused and must be re‑uploaded when needed.

For diagrams/images generated by LUMA ADHD, you can:

- Upload once with the relevant persona bot, store the returned `file_id` alongside your internal message record.
- Reuse that `file_id` any time the same persona needs to reshare the artifact in the same or another chat.

### 7.3 Buttons and commands

Inline keyboards (`InlineKeyboardMarkup`) and callback data (`callback_query`) are ideal for structured interactions:[web:15]

- Use compact buttons: `Approve`, `Revise`, `Summarize`, `Escalate to GOD`.
- Keep callback data as short IDs pointing into your backend (e.g. `thread:123|vote:+1`).
- Use a single persona (gateway bot) for most button flows to reduce confusion.

Slash commands remain useful for power flows (`/thread`, `/status`, `/god`, `/vote`), but for ADHD‑friendly UX prefer tap‑based buttons where possible.[web:19]


## 8. Using Telegram as File Storage

### 8.1 Pros and mechanics

Telegram encourages reuse of media via `file_id`:[web:24][web:22][web:25]

- Once a file is uploaded, there are **no size limits** for resending it by `file_id` (within Bot API’s general constraints).
- Resending by `file_id` is faster and uses no extra bandwidth on your side.
- You can call `getFile` with a `file_id` to obtain a download URL for the file, valid for a limited time.

For LUMA ADHD this means Telegram can act as a **cold storage** layer for many generated images and documents.

### 8.2 Limitations and risks

Important constraints when treating Telegram as storage:[web:24][web:25][web:30][web:32]

- `file_id` is **not stable across bots** and may change across time or if files are migrated; the docs caution that file identifiers may change and you should not rely on them for long‑term storage semantics.
- There is no SLA or retention guarantee; Telegram may delete unused files after an unspecified period.
- Thumbnails cannot be reused; you must regenerate or reupload them.
- You cannot change file type when resending by `file_id` (e.g. a photo cannot be resent as a document).

Recommendation: treat Telegram as a **cache** rather than primary storage. Persist canonical artifacts in Cloudflare R2 or another durable store, and keep `file_id` as an optimization layer.


## 9. Security and Access Control

### 9.1 Webhook authentication

Security measures for LUMA ADHD’s Telegram ingress:[web:27][web:28][web:26][web:42]

- Use `secret_token` when calling `setWebhook` for each bot and validate `X-Telegram-Bot-Api-Secret-Token` on every request.
- Validate the secret **before** reading the request body to prevent resource‑exhaustion attacks.
- Serve webhooks only over HTTPS (enforced by Cloudflare Workers’ TLS termination).

### 9.2 Bot token protection

- Store bot tokens only in Cloudflare Worker environment variables, never in code or logs.[web:39][web:44][web:50]
- If a token is suspected compromised, revoke it via @BotFather and update the Worker config.
- When using a reverse‑proxy Worker for Telegram API, consider adding a shared secret header between your backend and the proxy to prevent abuse of the proxy URL.[web:46][web:38]

### 9.3 Authorized human/admin IDs and spoofing

- Maintain an allowlist of Telegram user IDs with elevated permissions (e.g. `GOD` control, system resets, or cross‑thread actions).[web:15]
- For sensitive commands (`/god`, `/admin`, `/config`), enforce that `from.id` is in the admin list, independent of group roles.
- Do not trust editable message text for authentication context; use stable IDs (`from.id`, `chat.id`) and internal state.


## 10. UX Design for 8–15 Bots in One Group

### 10.1 Avoiding UI clutter

With many personas, the main risk is a noisy, unreadable group. Suggested patterns:

- **Gateway persona** as the primary narrator:
  - Gateway bot posts most summaries, decisions, and status messages.
  - Persona bots speak mainly when:
    - Addressed explicitly via reply or mention.
    - Casting a vote (`Critic`, `Optimist`, `RiskBot`).
- Use **short, structured prefixes**:
  - `🧩 Planner:`
  - `🧪 Critic:`
  - `🧷 Archivist:`
- Collapse verbose intermediate reasoning behind buttons or in threaded replies instead of top‑level messages.

### 10.2 Exposing status, conclusions, and votes

Recommended patterns:

- **Status messages** (gateway bot):
  - `**Status:** 🟢 In progress · Thread #12 · Owner: @user`
- **Conclusions**:
  - Single concise message: `**Conclusion (Thread #12):** <one or two lines>`.
  - For long conclusions, attach as a document or paste a short summary plus `View full in file »`.
- **GOD interventions**:
  - Gateway bot posts `🧠 GOD override by @NebulaAI: <short directive>`.
- **Votes**:
  - Persona bots react with buttons or emoji; the gateway bot posts a compact tally: `Votes: ✅ 3 · ❌ 1 · 🤔 2`.

### 10.3 Reply chains and threading

To keep ADHD‑friendly readability:

- Encourage humans and bots to **reply to the last relevant message**, not always to the latest random message.
- For each internal thread, pin a **thread header message** (by the gateway bot), and have personas reply to that so the chain is visually grouped.
- Use Telegram topics (if enabled) to partition big themes (e.g. `#architecture`, `#ops`, `#product`).


## 11. Recommended LUMA ADHD Architecture

### 11.1 High-level components

- **Telegram layer**:[web:12][web:10][web:19]
  - One gateway bot (admin in workspace group, privacy either ON or OFF).
  - 8–15 persona bots (non‑admin, privacy ON, optional Bot‑to‑Bot mode).
- **Cloudflare layer**:[web:42][web:49][web:50]
  - **Webhook Worker** – receives updates from all bots, validates secrets, normalizes updates, and forwards them to the core multi‑agent engine via internal dispatch (e.g. Durable Object or service binding).
  - **Agent Engine Worker** – maintains the canonical conversation model, runs multi‑agent orchestration and tool calls.
  - **Telegram API Proxy Worker** (optional) – reverse proxy for Telegram API to bypass regional blocks and centralize logging.
  - **Storage** – Cloudflare R2 (or similar) for canonical files, KV/D1 for metadata and rate‑limit buckets.

### 11.2 Message flow diagrams (text description)

**Inbound flow (human → Telegram → multi‑agent):**[web:15][web:49]

1. Human posts a message in the LUMA ADHD group.
2. Telegram sends updates to:
   - Gateway bot webhook (always, because it is admin / privacy OFF).
   - Persona bot webhook if the message is a reply or explicit mention and privacy rules allow.
3. Cloudflare Webhook Worker (single endpoint) receives the POST:
   - Verifies `X-Telegram-Bot-Api-Secret-Token` against stored secret for that bot.
   - Parses the update and resolves the bot identity from URL/path.
   - Normalizes the message into the internal conversation model, assigning user, chat, and thread.
   - Enqueues a task or calls the Agent Engine Worker via service binding with the normalized event.
4. Agent Engine Worker:
   - Updates the canonical conversation state.
   - Runs planning/reasoning across the multi‑agent graph (Planner, Critic, GOD, etc.).
   - Produces one or more **agent actions**, each specifying:
     - Target internal agent.
     - Target chat (Telegram group).
     - Message content, buttons, attachments.

**Outbound flow (multi‑agent → personas → Telegram → humans):**[web:17][web:21][web:39]

1. Agent Engine Worker aggregates actions and passes them to a **Telegram dispatch module**.
2. Dispatch module:
   - Maps internal agent → Telegram bot token.
   - Enforces rate limits via per‑chat and per‑bot token buckets.
   - Calls Telegram Bot API (directly or via proxy Worker) with `sendMessage`, `sendPhoto`, `sendDocument`, etc.
3. Telegram delivers messages to the group under the chosen persona bot’s name.
4. Future replies to those persona messages will carry `reply_to_message.message_id`, which the webhook Worker maps back into the internal thread context.

### 11.3 Important API constraints baked into design

- **Visibility**: Rely on the gateway bot as admin for full group visibility; keep persona bots in privacy mode to avoid duplicated updates and complexity.[web:12][web:10][web:19]
- **Bot‑to‑bot**: If you want the gateway to observe persona messages as updates rather than relying solely on internal routing, enable Bot‑to‑Bot Communication Mode for involved bots and ensure the gateway is admin.[web:8][web:7]
- **Rate limits**: Centralized dispatch in Cloudflare must respect ~1 msg/sec per chat, ~20 msg/min per group, and 30 msg/sec per bot, with robust 429 handling.[web:21][web:17][web:16][web:35]
- **Storage**: Use Telegram `file_id` as a cache only; keep canonical copies of artifacts in R2 to avoid retention and mobility issues.[web:24][web:25][web:30]
- **Security**: Webhook secret tokens are mandatory; bot tokens stay only in Worker environment; validate secrets before doing any body I/O.[web:27][web:28][web:31][web:33][web:50]

With this architecture, LUMA ADHD gets a single coherent multi‑agent brain with multiple Telegram faces, stable threading and reply chains, and a Cloudflare‑native backend that respects Telegram’s evolving visibility and rate‑limit rules.
