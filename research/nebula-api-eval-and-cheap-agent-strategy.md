# Nebula API Evaluation and Cheap-Model Agent Strategy

**Note:** The requested Nebula API guide at `https://nebula-free-llm.nebula-ai-company.workers.dev/nebula-api-guide.md` could not be retrieved via HTTP during this research session, so this report infers Nebula’s behavior from public Nebula/Breachline documentation plus generic OpenAI-compatible patterns rather than that specific file.[cite:1][cite:2]

## 1. Nebula API surface and compatibility

### 1.1 Core endpoints

Public Breachline/Nebula docs describe an OpenAI-compatible LLM API surface with the following endpoints:[cite:2]

| Purpose | Method & Path | Notes |
| --- | --- | --- |
| Chat completions | `POST /api/v1/llm/v1/chat/completions` | Primary endpoint, OpenAI chat-compatible (messages array, tool calling, streaming).[cite:2] |
| Text completions | `POST /api/v1/llm/v1/completions` | Legacy text completion pattern, similar to OpenAI’s `/v1/completions`.[cite:2] |
| List models | `GET /api/v1/llm/v1/models` | Returns available models and pricing/metadata.[cite:2] |
| Usage stats | `GET /api/v1/llm/v1/usage/current` | Per-key current usage, useful for monitoring & rate-limit awareness.[cite:2] |

Because the platform is explicitly promoted as “OpenAI-compatible” and a “drop‑in replacement,” you can assume the paths, verbs, and JSON shapes mirror OpenAI’s v1 API closely enough that standard OpenAI client libraries will mostly work with a base‑URL change plus header adjustments.[cite:1][cite:2]

### 1.2 Authentication

Nebula uses API-key authentication via a custom header rather than OpenAI’s `Authorization: Bearer` scheme:[cite:2]

- Header: `X-API-Key: <your_key>`
- Keys are created in the Breachline dashboard under *Settings → API Keys*, scoped with permissions such as `llm:*` for LLM access.[cite:2]

For LUMA ADHD, the provider adapter should:

- Accept a logical `apiKey` value for Nebula.
- Map it into the `X-API-Key` header when calling Nebula.
- Allow a per-provider configuration so other providers (OpenAI, Anthropic, etc.) can keep their own auth formats.

### 1.3 Request schema (chat completions)

Given the explicit OpenAI-compatibility, the chat request schema is expected to match OpenAI’s `/v1/chat/completions` with minor or no differences:[cite:1][cite:2]

```json
{
  "model": "nebula-model-id",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.3,
  "max_tokens": 1024,
  "stream": false,
  "tools": [ /* optional OpenAI-style tool specs */ ],
  "tool_choice": "auto" /* or explicit */
}
```

Key fields to rely on:

- `model` – Nebula model identifier (e.g., `Sao10K/L3-8B-Stheno-v3.2` or a short alias, depending on the deployment).[cite:3]
- `messages` – array of `{role, content}` items with roles `system`, `user`, `assistant`, `tool`.
- Common sampling controls – `temperature`, `top_p`, `max_tokens`, `presence_penalty`, `frequency_penalty` are likely supported but should be feature-detected.
- `stream` – boolean flag enabling server-sent-events (SSE) streaming of partial deltas.[cite:1][cite:2]
- `tools` / `tool_choice` – OpenAI‑style tool/JSON‑schema function calling is advertised as supported.[cite:1][cite:2]

Because access to the specific Nebula guide failed, unknowns remain about any non-OpenAI extensions (e.g., special metadata fields), so the LUMA adapter should:

- Whitelist only the OpenAI fields you use today.
- Allow pass-through of arbitrary extra fields via a `providerParams` object for future extensions.

### 1.4 Response schema (chat completions)

Breachline/Nebula describe the API as “drop-in OpenAI replacement,” implying the standard chat completion structure:[cite:1][cite:2]

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1719860000,
  "model": "nebula-model-id",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "...",
        "tool_calls": [ /* optional */ ]
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 123,
    "completion_tokens": 456,
    "total_tokens": 579
  }
}
```

For streaming, expect OpenAI-style SSE events with `data: {"id":..., "choices":[{"delta":{...}}]}` and a terminating `data: [DONE]` line.[cite:1][cite:2]

The adapter should:

- Normalize Nebula responses into LUMA’s internal `LLMResponse` type (text, toolCalls, finishReason, usage, rawProviderResponse).
- Not rely on undocumented fields; only depend on `choices[0].message`, `finish_reason`, and `usage`.

## 2. Models and capabilities

### 2.1 Available models

Public Nebula Block content highlights at least one key model: **L3‑8B Stheno v3.2** hosted on Nebula Block and accessible via an OpenAI-compatible endpoint `https://inference.nebulablock.com/v1/chat/completions` with model name `Sao10K/L3-8B-Stheno-v3.2`.[cite:3]

The Breachline “Nebula API Documentation” describes a generic `GET /api/v1/llm/v1/models` endpoint returning model list and pricing.[cite:2]

From these, it is reasonable to assume that:

- Nebula exposes multiple models, possibly including:
  - Small/cheap models (e.g., 3B–8B class) for light agents.
  - Larger models for heavier reasoning.
- Each deployment (Nebula Block vs Breachline Nebula) can configure its own model catalog behind the OpenAI-compatible layer.[cite:2][cite:3]

For LUMA ADHD, the adapter must:

- Treat Nebula’s model list as dynamic, pulling model metadata at startup or periodically via `/models` and caching it.
- Map LUMA logical roles (e.g., `normal_agent`, `specialist_agent`, `GOD`) onto specific Nebula model IDs via configuration rather than hard-coding.

### 2.2 Capabilities and context limits

The Stheno v3.2 spec shows an 8K token context when hosted on Nebula Block.[cite:3] Other Nebula models may differ, but the `/models` endpoint is likely to surface `context_window` or `max_tokens` metadata.

Practical guidance:

- **Hard assumption:** do not exceed 8K tokens per request for any given Nebula model unless the `/models` metadata explicitly says more.[cite:3]
- **Soft behavior:** treat `max_tokens` as you would on OpenAI—keep `prompt_tokens + max_tokens` under the model’s context limit.

Core capabilities to rely on:

- General-purpose chat completion with instruction-following.
- Good performance on structured tool calls and JSON-style outputs if well-prompted (OpenAI-compatible tools).[cite:1][cite:2]
- Latency suitable for interactive agents on small models; large models will be slower.[cite:3]

Capabilities not guaranteed without testing:

- Advanced reasoning on very long or deeply nested contexts.
- Highly nuanced multi-step chain-of-thought without explicit decomposition.
- Perfect adherence to strict JSON schemas without guardrails.

### 2.3 Streaming

Breachline explicitly advertises “OpenAI-compatible API with tool calling and streaming,” which implies SSE streaming support for chat/completions in the same pattern as OpenAI.[cite:1][cite:2]

For LUMA:

- Support both streaming and non-streaming modes in the provider abstraction.
- For **normal agents**, prefer non-streaming to simplify parsing and tool-call extraction.
- For user-facing chat, optionally expose streaming while still buffering internally until you have a full message or tool invocation.

### 2.4 Tool/function calling and structured output

The Breachline docs mention **tool calling** and **MCP support** as first-class features for Nebula.[cite:1][cite:2]

Implications:

- Nebula should accept OpenAI-style `tools` array with JSON-schema descriptions and return `tool_calls` in the assistant message when appropriate.
- It is likely to respect `tool_choice` (`auto`, `none`, or a specific tool name) similar to OpenAI.

For structured JSON output without tools:

- Cheap models often drift away from strict JSON unless strongly constrained.
- Use a combination of:
  - Explicit “respond with ONLY valid JSON, no extra text” instructions.
  - JSON `response_format` parameter if Nebula supports OpenAI’s `response_format: {"type":"json_object"}`; if not documented, treat it as experimental.[cite:1][cite:2]
  - Post-parsing with robust error handling (JSON5 tolerant, bracket/quote repair) in the adapter.

### 2.5 Multimodal support

Public Nebula/Breachline LLM docs focus on text/chat; there is no explicit mention of image or audio multimodal endpoints.[cite:1][cite:2][cite:3]

Therefore:

- Assume **text-only** for the Nebula LLM API unless your private Nebula guide explicitly documents multimodal features.
- Keep the provider abstraction multimodal-capable (separate `chat`, `vision`, `audio` capabilities flags) so you can wire future providers (OpenAI o3, GPT‑4.1‑mini, etc.) without changing agent logic.

### 2.6 Rate limits, concurrency, timeout behavior

Breachline’s Nebula docs list example usage limits per API key as:[cite:2]

- 60 requests per minute.
- 1K requests per hour.
- 10K requests per day.
- 100K tokens per minute.

These values may vary by plan or deployment, but they provide a reasonable design baseline.

Timeout and reliability behavior is not fully specified, but standard patterns apply:[cite:1][cite:2]

- HTTP 429 for rate limits.
- HTTP 5xx for transient server issues.
- Per-request timeouts likely between 30–60 seconds for larger generations.

The LUMA Nebula client should:

- Implement **client-side timeouts** (e.g., 20–30s for cheap models; 60s for expensive long generations) and treat timeouts as retryable where idempotent.
- Use **connection pooling** and keep-alive to avoid connection churn under concurrency.
- Enforce **a global QPS/token budget** per API key to stay under documented limits.

## 3. Error formats, retries, and reliability

### 3.1 Error schema

OpenAI-compatible implementations typically mirror OpenAI’s error schema:

```json
{
  "error": {
    "message": "Rate limit exceeded",
    "type": "rate_limit_exceeded",
    "code": null
  }
}
```

Breachline’s positioning as “drop-in replacement” implies similar fields, returned with appropriate HTTP status codes (400, 401, 403, 404, 422, 429, 5xx).[cite:1][cite:2]

Adapter requirements:

- Parse errors into a normalized `ProviderError` type with:
  - `statusCode`
  - `providerCode` (e.g., `rate_limit_exceeded`)
  - `message`
  - `retryable` (boolean)
- Log raw error bodies for debugging in non-user‑facing logs.

### 3.2 Retry policy

Recommended retry behavior for Nebula in LUMA ADHD:

- **Retry with exponential backoff** (e.g., 250ms → 500ms → 1s → 2s) on:
  - HTTP 429 rate limits.
  - 500–503 transient server errors.
  - Network errors (connection reset, DNS, TLS) when safe.
- **Do not retry** on:
  - 400–422 (invalid request, bad model, invalid tool schema).
  - 401/403 (auth/permissions).

Cap retries at **3 attempts** and surface failures to the orchestrator, which can escalate to GOD or alternative providers when needed.

### 3.3 Reliability and suitability for persistent agents

Potential reliability concerns when using Nebula as the primary provider for always-on agents:

- **Undocumented or plan-dependent rate limits** can throttle persistent autonomous agents if not monitored.[cite:2]
- **Model updates** (e.g., Stheno v3.1 → v3.2) may change behavior subtly; strongly task‑pinned prompts and tests are needed to detect regressions.[cite:3]
- **Regional outages** or network issues can break all agents if Nebula is the only provider.

Mitigations for LUMA ADHD:

- Implement **provider health checks** (periodic lightweight prompts) and circuit breaker behavior.
- Add **automatic failover** from Nebula to a backup provider (e.g., OpenAI, Anthropic) where tasks allow it.
- Maintain **behavioral test suites** for each agent role; run them when changing Nebula models or major prompts.

Nebula remains suitable for persistent autonomous agents **if** the orchestrator handles rate limits, retries, and failover rather than assuming perfect availability.

## 4. OpenAI compatibility vs custom adapter

### 4.1 Compatibility level

Nebula is explicitly advertised as:

- “Access Nebula via OpenAI-compatible API.”[cite:1]
- “Drop-in replacement for existing LLM integrations” with tool calling and streaming.[cite:1][cite:2]

This means most existing OpenAI `chat.completions`-style clients will work against Nebula with:

- A **base URL change**.
- Changing authentication from `Authorization: Bearer` to `X-API-Key`.

### 4.2 Why LUMA still needs a dedicated provider abstraction

Even with wire compatibility, LUMA ADHD should **not** treat Nebula as just “OpenAI with a different URL,” because:

- Rate limits, error codes, and model catalogs differ.[cite:2][cite:3]
- You want to support **multiple providers** (Nebula, OpenAI, Anthropic, local vLLM) under a single agent orchestration layer.
- Some provider-specific features (MCP, structured outputs, large context windows, vision) are non-uniform.

Therefore you should implement a **thin but explicit Nebula adapter** that:

- Implements LUMA’s internal provider interface (`chat`, `streamChat`, `listModels`, `getUsage`, etc.).
- Performs Nebula-specific auth headers, URL prefixes, and quirks.
- Normalizes responses and errors into LUMA’s internal types.

## 5. Recommended provider abstraction for LUMA ADHD

### 5.1 Internal provider interface

Define a provider-agnostic interface, for example:

```ts
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string; // for tools
}

interface ToolDefinition {
  name: string;
  description?: string;
  jsonSchema: unknown;
}

interface ChatRequest {
  model: string; // logical model key, not provider ID
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { name: string };
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
  providerParams?: Record<string, unknown>;
}

interface ToolCallResult {
  id: string;
  name: string;
  argumentsJson: string;
}

interface ChatResponse {
  message: ChatMessage;
  toolCalls?: ToolCallResult[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  raw?: unknown; // provider raw response
}

interface LLMProvider {
  name: string;
  chat(req: ChatRequest, options?: { signal?: AbortSignal }): Promise<ChatResponse>;
  streamChat?(req: ChatRequest, onDelta: (partial: ChatResponse) => void, options?: { signal?: AbortSignal }): Promise<void>;
  listModels?(): Promise<ProviderModelInfo[]>;
}
```

Then implement **NebulaProvider** and other providers behind this interface.

### 5.2 Nebula-specific adapter behavior

NebulaProvider should:

- Map `ChatRequest` → OpenAI-compatible JSON for `POST /api/v1/llm/v1/chat/completions`.
- Inject `X-API-Key` and Nebula base URL.
- Handle streaming SSE if `streamChat` is used.
- Normalize Nebula’s `tool_calls` into `ToolCallResult[]`.
- Emit `finishReason` based on Nebula’s `finish_reason`.
- Populate `usage` from Nebula’s `usage` struct.

Do **not** expose Nebula-specific details to agents; the orchestrator chooses provider/model per agent via configuration.

## 6. Cheap-model specialized-agent strategies

The second half of the design problem is making **cheap, weaker models** (like small Stheno-class models) behave reliably as specialized agents within LUMA ADHD.

### 6.1 System prompt structure for cheap agents

Guidelines:

- Keep system prompts **short, explicit, and role-centric** to stay within weak models’ working memory.
- Use a **fixed template** per agent type, for example:

```text
You are the {ROLE_NAME} agent in the LUMA ADHD assistant.

Your responsibilities:
1. {Responsibility 1}
2. {Responsibility 2}

Constraints:
- Never perform actions outside these responsibilities.
- If information is missing, ask for clarification instead of guessing.
- Prefer concise, structured outputs.

When you need to propose actions, respond in the exact JSON schema provided.
```

- Avoid long philosophy or generic advice in the system prompt; use targeted bullet lists of behaviors.
- Encode **priority rules** (safety > correctness > verbosity) explicitly.

### 6.2 Restricted action schemas

Cheap models perform much better when their **action space is narrow and typed**.

- For each agent, define one or a small number of JSON schemas that encode allowed actions, e.g.:

```json
{
  "type": "object",
  "properties": {
    "action": { "type": "string", "enum": ["ASK_USER", "CALL_TOOL", "FINISH"] },
    "tool": { "type": "string" },
    "arguments": { "type": "object" },
    "explanation": { "type": "string" }
  },
  "required": ["action"],
  "additionalProperties": false
}
```

- Provide this schema either as:
  - An OpenAI-style `tool` definition so Nebula returns `tool_calls`.
  - Or an explicit “Respond with JSON matching this schema” instruction plus post-parsing.
- Keep enums short and avoid overlapping options (e.g., `SEARCH_MEMORY` vs `RETRIEVE_MEMORY`, pick one).

### 6.3 Structured output and parsing

To keep weak models aligned with structured outputs:

- Always include a **few-shot example** of correct JSON responses in the prompt.
- Tell the model to **omit prose** outside JSON when in “action” mode, e.g.: “When in ACTION mode, respond with JSON only, no extra text.”
- Implement a **fault-tolerant parser**:
  - Strip leading/trailing text.
  - Attempt strict JSON parse; if it fails, apply small repairs (quote fixes, trailing commas) and re-parse.
  - If still invalid, ask the model (or another checker model) to repair the JSON using a `"repair_json"` tool.

### 6.4 Context compression and memory retrieval

Cheap models with limited context require aggressive **context management**:

- Use a **vector store or lightweight memory index** keyed by:
  - User
  - Agent role
  - Topic/task ID
- Before each agent call, **retrieve only the top-k relevant memory chunks** (e.g., 3–5 items) based on the current query.
- Provide these as a **compressed summary** rather than raw logs:
  - Maintain running **summaries of past conversations** per task.
  - Teach a dedicated “Summarizer” agent (which can also be a cheap model) to compress conversation turns into bullet points.

Pattern:

1. User / orchestrator creates a task with minimal context.
2. Memory subsystem retrieves the top‑k relevant notes and summary for that task.
3. These are injected into the **system or first assistant message** for the working agent.
4. After each agent step, the transcript and actions are re-summarized and stored.

### 6.5 Separating reasoning from action execution

Cheap models can still hallucinate actions if asked to reason and act in a single step. Split into two phases:

1. **Reasoning phase** (cheap model):
   - Hidden from the user.
   - The agent produces a **chain-of-thought style plan** and proposed action JSON.
   - This can be either in `assistant` content or behind an internal “planner” tool call.
2. **Execution phase** (separate executor):
   - A deterministic component or a specialized “Tool Executor” agent reads the JSON and executes tools.
   - User-visible messages are constructed from executed tool results, not directly from the planning text.

For example:

- `PlannerAgent` (Nebula cheap model) → JSON `{ "action": "CALL_TOOL", "tool": "search_docs", "arguments": { "query": "..." } }`.
- `ToolExecutor` (code) executes the tool and then asks `WriterAgent` (maybe a stronger model or the same cheap model) to summarize tool output for the user.

### 6.6 Verification, self-critique, and multi-agent critique

To raise reliability:

- Add a **self-check step** for each important agent output:
  - After the agent produces JSON or a response, send it back to the same model with a system prompt like: “Check the following output for consistency with the schema, factual errors given the provided tool results, and missing required fields. Respond with either APPROVE or REVISE plus an updated JSON if needed.”
- For critical tasks, use a **second cheap model instance** as a reviewer:
  - `WorkerAgent` produces an answer.
  - `ReviewerAgent` receives the conversation plus answer and must label it as `OK`, `MINOR_ISSUES`, or `MAJOR_ISSUES` with specific feedback.
  - If `MAJOR_ISSUES`, orchestrator can re-prompt the worker with the feedback.

Periodically, **GOD (frontier model)** evaluates samples:

- Inspect randomly sampled agent outputs.
- Label systematic failure modes (hallucinated tools, missing required fields, poor recall of ADHD-specific heuristics).
- Suggest prompt or schema changes.

### 6.7 Preventing hallucinated tool calls

To reduce hallucinated API/tool usage:

- Maintain a **strict list of allowed tools** per agent and never expose names of internal or unavailable tools.
- In the system prompt, state: “You may only call one of these tools: {TOOL_LIST}. Never invent other tools; if none is suitable, answer with `action: "ASK_USER"`.”
- Use **OpenAI-style tool calling** where Nebula decides whether to call a tool; then the orchestrator enforces validity:
  - If Nebula returns a tool name not in the registry, reject the call and ask it to try again with a valid tool.
- Implement a **tool-call validator** that:
  - Verifies tool name in registry.
  - Validates `arguments` against JSON schema (types, required fields).
  - Returns explicit errors back to the agent (or to a checker model) when invalid.

### 6.8 Maintaining personality without degrading task quality

For LUMA ADHD, a warm, neurodivergent-friendly personality is important, but it should not interfere with task execution.

Pattern:

- Keep **core agent logic prompts** neutral and procedural.
- Add personality in a **post-processing step**:
  - `WorkerAgent` focuses on structure and correctness.
  - `StylistAgent` (cheap model) takes the worker’s structured answer and rewrites only the surface language (“tone transformation”) to match LUMA’s persona (supportive, clear, non-judgmental) while preserving content.
- Alternatively, keep personality instructions in a small, separate paragraph in the system prompt:

```text
Tone:
- Friendly, clear, and non-judgmental.
- Avoid shaming language.
- Prefer short, concrete suggestions over vague advice.
```

- Avoid mixing personality with **action schemas**. JSON outputs should remain personality‑neutral; personality affects only human-facing text.

## 7. GOD model oversight architecture

To combine cheap Nebula agents with a powerful frontier model (GOD):

- Treat Nebula as the **default engine** for:
  - Routine planning.
  - Memory retrieval and summarization.
  - Low-risk tool orchestration.
- Use GOD only for:
  - Final review of complex tasks.
  - High-stakes reasoning (e.g., interpreting medical guidelines, complex ADHD strategy design, but not personal diagnosis or treatment decisions).
  - Diagnosing failure patterns in cheap agents and suggesting prompt/schema changes.

Workflow example:

1. Task enters the system.
2. Nebula-based **RouterAgent** decides whether the task is simple or complex.
3. For simple tasks, Nebula agents execute end-to-end with local self-checks.
4. For complex tasks:
   - Nebula agents generate a draft.
   - GOD receives: task description, relevant memory, draft answer, and tool outputs.
   - GOD returns: a) approval, b) edited answer, or c) request for additional tools / clarifications.
5. Orchestrator applies GOD’s verdict and updates prompts or schemas over time.

## 8. Nebula-specific integration recommendations

### 8.1 Capabilities to rely upon

Based on current public documentation, you can safely rely on Nebula for:[cite:1][cite:2][cite:3]

- OpenAI-compatible chat completions and text completions.
- Tool calling with OpenAI-style `tools` definitions.
- Streaming via SSE.
- Reasonable small-model performance for structured tasks when prompts and schemas are tight.
- Rate limits around the documented order of magnitude (tunable via configuration).

### 8.2 Capabilities you should not assume

Do **not** assume without explicit confirmation and testing:[cite:1][cite:2][cite:3]

- Multimodal image/audio input or output.
- Very large context windows (> 8K tokens) for all models.
- Perfect JSON compliance without external parsing/repair.
- Identical behavior to OpenAI in edge cases (e.g., `stop` sequences, `logprobs`, `response_format`).
- Hard real-time guarantees under high concurrency.

### 8.3 Failure-handling policy

For Nebula within LUMA ADHD:

- Implement **three-layer defense**:
  1. **Request-level:** per-call timeout, retries on 429/5xx, robust parser, schema validation.
  2. **Agent-level:** self-check, reviewer agent, action-schema enforcement.
  3. **System-level:** provider health checks, circuit breakers, failover to GOD or other LLMs.
- Log structured events for:
  - Rate-limit hits.
  - Parsing failures and JSON repairs.
  - Tool validation failures.
- Use these logs in periodic GOD reviews to refine prompts and detect provider regressions.

### 8.4 Recommended prompt architecture for normal agents

Template for a **normal Nebula-based LUMA agent**:

1. **System message** (short, role + constraints + tone):

```text
You are the {AGENT_NAME} agent in the LUMA ADHD assistant.

Responsibilities:
- {Responsibility list}

Constraints:
- Operate only within your responsibilities.
- Use only the tools listed below when you need external data.
- If required information is missing, respond with an action that asks the user for clarification.

Tone:
- Friendly, clear, and non-judgmental.
- Prefer concrete, short suggestions.

When proposing actions, respond with JSON matching the schema provided.
```

2. **Tool definitions** (OpenAI tools or explicit schemas) with 1–3 tools per agent.
3. **Assistant primer** with 1–3 **few-shot examples** of valid JSON actions and correct use of tools.
4. **User/Task message** with:
   - Current user question.
   - Compressed relevant memory.
   - Any tool results from prior steps.

### 8.5 Model selection with Nebula

Assuming Nebula offers multiple models (small/cheap, medium, larger):[cite:2][cite:3]

- **Normal agents:**
  - Use the **smallest reliable model** (e.g., 3B–8B class like Stheno v3.2) with tight prompts and schemas.
  - Optimize for latency and cost.
- **Critical specialist agents** (e.g., ADHD planning logic, safety reviewer):
  - Use a slightly larger Nebula model or a higher-quality external model when cost allows.
- **GOD model:**
  - Use a frontier model from another provider (e.g., OpenAI o3, Claude 3.5, etc.), not Nebula, to maximize diversity and catch systemic Nebula failures.

## 9. Key risks

- **Provider dependence:** Relying heavily on Nebula without a fallback can expose LUMA to outages, pricing changes, or model regressions.[cite:2][cite:3]
- **Weak-model limitations:** Cheap small models can still hallucinate or misinterpret ADHD-related context if prompts and schemas are lax.
- **Undocumented constraints:** Hidden rate limits, context limits, or safety filters may appear only under load or specific content patterns.[cite:1][cite:2]
- **User trust:** If cheap agents occasionally produce off-target or confusing advice, neurodivergent users may lose trust quickly; GOD oversight and stylistic consistency are crucial.

With the proposed provider abstraction, strict schemas, multi-step verification, and GOD oversight, Nebula can serve as an effective low-cost backbone for LUMA ADHD’s everyday agents while preserving a clean escape hatch to other providers.
