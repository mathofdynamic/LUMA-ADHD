# Telegram Media and Group Truth

This document describes the post-v1 Telegram media and group-interaction contract.

## Media pipeline

The gateway is the only Telegram ingress. A validated Telegram update may contain:

- text;
- a photo with or without a caption; or
- an image document with an optional caption.

The canonical message stores attachment metadata in `messages.metadata_json`:
source, Telegram file identifiers, MIME metadata, dimensions, file size, and an
optional filename. It never stores image bytes, Base64, or a token-bearing file URL.

For a turn that needs an image, the Worker:

1. calls Telegram `getFile` using the gateway credential;
2. accepts only a validated relative Telegram `file_path`;
3. downloads from Telegram's official file endpoint;
4. enforces the internal 5 MiB image bound and supported image magic bytes;
5. sends an in-memory `data:image/...;base64,...` part to the OpenAI Responses API;
6. discards the bytes after the bounded Worker invocation.

The application supports PNG, JPEG, WebP, and GIF signatures; it does not perform
animation-specific processing. SVG,
HTML, arbitrary documents, arbitrary URLs, and files whose magic bytes disagree
with their declared type are rejected. One current/replied-to image is the default
maximum for a turn. No R2 or other object store is required.

An image is included only when it is on the current message or is the direct
reply target of the current message. Historical attachment metadata is not image
content and is never silently supplied to a later turn.

The normal Agent provider remains OpenAI `gpt-5.6-luna` with reasoning `medium`.
The provider-neutral LLM contract uses text and image-data parts; the OpenAI
adapter maps them to Responses API `input_text` and `input_image`. Nebula remains
implemented as a text-capable fallback and rejects multimodal input rather than
pretending to see it.

## Capability truth

Every runtime Agent turn receives a compact capability manifest. It distinguishes:

- global model vision support;
- an image attachment being present in canonical state;
- media fetch status; and
- image bytes actually delivered to this exact model request.

Agents must not claim to see, inspect, open, hear, browse, or access something
unless the manifest confirms that capability for the turn. Image metadata is not
image delivery. If fetch or provider preparation fails, the canonical message and
metadata remain while the Agent is prevented from making a positive vision claim.

Vision content is current-turn evidence. It does not grant permission to identify
real people or invent details outside the visible image.

## Shared group awareness

Telegram is the visible shared workplace, but not every Agent receives an LLM turn
for every message. Runtime snapshots expose only bounded facts:

- active normal roster;
- current interaction mode;
- invoked Agents;
- responding Agents;
- pending Agents; and
- the last roll-call target/respond/failure lists when relevant.

An Agent must not infer that a quiet Agent is offline. A message existing in D1
does not prove that every Agent actively processed it. `agent-god` is an internal
supervisor with no Telegram persona. The gateway is a transport/control identity,
not a ninth normal Agent.

## Roll-call mode

An authorized human can explicitly request attendance with phrases such as
“everyone say you are here” or the Persian equivalent of “اعلام حضور”. This is a
deterministic `ROLL_CALL` path:

- targets active normal Agents only;
- projects one short acknowledgement through each Agent's mapped persona bot;
- uses no Luna calls and creates no reasoning turns or reputation evidence;
- replies to the human's Telegram message where possible;
- records targeted, responded, failed, and skipped Agent IDs; and
- uses update ID plus Agent ID idempotency, so webhook replay cannot create a
  second acknowledgement set.

Roll-call requests are restricted to configured Admin/authorized Telegram users
and have a short equivalent-request cooldown. Paused Agents are not impersonated.
A transport failure is recorded as failure; it is never represented as a success.

## Explicit all-Agent broadcast

“Every Agent, give your opinion” is distinct from attendance. The deterministic
`EXPLICIT_ALL_AGENTS` path gives each active normal Agent at most one bounded Luna
turn, up to eight Agents. Each Agent receives the current shared context and its
role, must remain concise, and may honestly defer when the question is outside its
specialty. There is no second round, no GOD turn, and no gateway opinion.

Ordinary broad questions remain selective and bounded. They do not wake all eight
Agents merely because the human said “everyone” conversationally; explicit
per-Agent wording is required. Normal greetings keep the PR #14 social fast path.

## Failure and recovery

If media fetch fails, the message is still canonical and the safe status is stored
in Agent-turn metadata. No repeated media retry storm is started. If a persona
projection fails during a roll call, the roll-call event records the failed Agent
and the deterministic acknowledgement is not fabricated. Replaying a completed
roll call returns its stored result without sending again.

For current platform contracts, consult the official
[Telegram Bot API](https://core.telegram.org/bots/api),
[OpenAI GPT-5.6 Luna model reference](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[OpenAI Responses API reference](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create),
and [OpenAI image/vision guidance](https://developers.openai.com/api/docs/guides/images-vision).
