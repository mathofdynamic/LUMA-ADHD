# Designing a Persistent Multi-Agent Thinking System for LUMA ADHD

## Overview

This document proposes a practical orchestration model for a persistent autonomous multi-agent "strategy room" suitable for LUMA ADHD: 8–15 heterogeneous agents that continuously generate ideas, critique each other, revisit old discussions, and converge to useful conclusions over hours or days.[web:10][web:19] The design draws on modern multi-agent frameworks (AutoGen, LangGraph, CAMEL, CrewAI, MetaGPT, OpenAI Swarm/Agents) and recent academic work on multi-agent reasoning, memory, and hallucination propagation, and then distills them into a concrete architecture optimized for:

- Persistent, searchable deliberation
- Bounded cost and token usage
- Avoidance of loops, groupthink, and hallucination cascades
- Healthy disagreement plus eventual synthesis
- Cheap-model workers with a periodic frontier supervisor

All recommendations are implementation-oriented and assume you will likely build on LangGraph or a similar graph-based orchestrator with persistent memory (e.g., LangGraph + Redis/Mongo/Postgres checkpointers and stores).[web:31][web:41][web:44][web:50]

---

## 1. Architectural patterns from modern frameworks

### 1.1 AutoGen

AutoGen is a layered, event-driven framework for multi-agent systems with a Core actor model and higher-level AgentChat for conversational agents.[web:10][web:24][web:21]

Key takeaways:

- **Event-driven, asynchronous agents**: Agents wake up on message events rather than in a synchronous loop; this helps decouple message routing from agent logic and scales to many concurrent conversations.[web:10]
- **Conversable agents**: All agents conform to a unified messaging interface (`send/receive/generate_reply`), which simplifies orchestration and logging.[web:11][web:19]
- **Design patterns**: AutoGen documents patterns like `GroupChat`, `GroupChatManager`, and **Mixture-of-Agents** (worker layers plus orchestrator) that show how to route tasks and aggregate multi-agent outputs.[web:15][web:19]
- **Human-in-the-loop support**: Easy insertion points for human feedback and intervention within agent conversations.[web:14]

Implications for LUMA ADHD:

- Use an **event-driven runtime** rather than a blocking turn-by-turn loop so that agents can be woken by events (new message, timeouts, new external data) instead of spamming continuously.
- Adopt a **unified conversable agent interface** for all agents (workers and supervisor), with structured messages and explicit content types.

### 1.2 LangGraph

LangGraph models agent systems as stateful graphs with nodes (agents/tools) and edges (routing decisions), providing built-in patterns for multi-agent systems and persistent memory.[web:31][web:25][web:27]

Key features and patterns:

- **Supervisor / Router pattern**: A central supervisor node reads shared state and routes to specialist agents via conditional edges using `Command(goto=...)`.[web:31][web:32][web:33]
- **Network vs Supervisor vs Hierarchical**: Supervisor routing is recommended for most real systems: one accountable coordinator, multiple specialists, with optional hierarchical supervisors when there are many agents (>8).[web:27][web:30]
- **Checkpointers and Stores**: Separation of short-term conversation state (checkpointer per `thread_id`) and long-term, cross-thread memory via stores (with vector search and namespaces).[web:41][web:45][web:53][web:50]

Implications:

- Model your strategy-room as a **LangGraph-style supervisor graph**: one or two levels of supervisors plus 8–15 specialists.[web:27][web:32]
- Use **checkpointers** for per-thread deliberation state and a **memory store** for institutional memory and decision logs.[web:41][web:44][web:50]

### 1.3 CAMEL

CAMEL introduced role-playing between agents guided by “inception prompts” and showed that two LLM agents can autonomously cooperate on tasks with carefully designed roles.[web:12][web:16][web:17]

Key contributions:

- **Role-playing framework**: One agent as AI user, one as AI assistant, with roles and goals defined via inception prompts, enabling autonomous multi-turn cooperation.[web:12][web:17]
- **Failure mode taxonomy**: Identifies role flipping, conversation drift, instruction-response loops, and non-termination, plus prompt-level safeguards.[web:17]

Implications:

- Use **strong role prompts** and inception-style priming to differentiate personalities and responsibilities of your agents.
- Bake **termination conditions and anti-drift constraints** directly into agent prompts and the supervisor logic.

### 1.4 MetaGPT

MetaGPT encodes Standard Operating Procedures (SOPs) into multi-agent workflows, acting like a meta-programming framework for collaborative agents, especially for software projects.[web:18]

Key ideas:

- **Assembly-line pattern**: Complex tasks broken into SOP-driven stages (e.g., product manager → architect → coder → tester).[web:18]
- **Intermediate artifact verification**: Each stage validates and structures inputs to reduce cascading hallucinations.[web:18]

Implications:

- Treat your strategy-room not as free-form chat but as **structured workflows** (exploration → debate → synthesis → decision), with SOP-like prompts for each phase.
- Use intermediate artifacts (issue briefs, scorecards, decision records) to stabilize and verify before moving forward.

### 1.5 CrewAI

CrewAI is an open-source multi-agent platform emphasizing crews of agents with roles, tasks, and process types like Sequential, Hierarchical, and Consensual.[web:38][web:39]

Key lessons:

- **Process types**: Sequential pipelines, hierarchical manager–worker setups, consensual (discussion + voting), and hybrid flows for production.[web:38]
- **Shared memory**: Built-in memory to share context between agents, important for coherent collaboration.[web:39]

Implications:

- For strategic discussion, use **Consensual / Hierarchical** processes: a supervisor plus debating agents, with voting and explicit consensus-breaking rules.

### 1.6 OpenAI Swarm and Agents

OpenAI’s Swarm (experimental) provides a minimal conceptual model: agents, routines, handoffs, and shared context variables; later superseded by production Agents SDK.[web:46]

Key takeaways:

- **Handoffs instead of central orchestrator**: Agents can delegate control to other agents via handoffs, forming a decentralized state machine.[web:46]
- **Context variables**: Store shared state outside the LLM context.[web:46]

Implications:

- For LUMA ADHD, use **supervisor-led orchestration**, but selectively allow **decentralized handoffs** when agents want to escalate or call a human.

### 1.7 Recent research on multi-agent reasoning

Several recent works examine multi-agent debate and error propagation:

- **Multi-agent debate (MAD)**: Controlled studies show that debate success correlates more with intrinsic agent strength and diversity than with structural parameters like order; majority voting plus tie-breaking supervisors can improve accuracy.[web:40]
- **Error propagation and hallucination cascades**: Work on hallucination dynamics in multi-agent cascades shows that additional agents can attenuate hallucinations when they behave as corrective filters, but naive chaining can also propagate errors.[web:36]
- **Hallucination snowballing mitigation**: A 2026 study proposes context-aware semantic consistency reasoning and bidirectional entailment clustering to detect and mitigate hallucination snowballing in multi-agent collaborations.[web:37]

Implications:

- A **strong frontier supervisor** that periodically re-evaluates claims is more important than elaborate debate scheduling.[web:40][web:36]
- You need **claim-level grounding and entailment checks** to prevent hallucination cascades, especially when weaker/cheap models echo each other.[web:37][web:36]

---

## 2. Central orchestrator vs decentralized turn-taking

### 2.1 Topology options

LangGraph and related frameworks identify several multi-agent topologies:[web:31][web:27][web:30]

| Topology | Description | Pros | Cons |
| --- | --- | --- | --- |
| Network / Swarm | Every agent may call any other | Maximal flexibility, emergent behavior | Hard to debug, prone to loops and spam |
| Supervisor / Router | One supervisor routes between specialists | Clear control, easier logging and safety, good default | Supervisor bottleneck if overburdened |
| Hierarchical | Supervisor of supervisors | Scales to many agents, organizational structure | Higher complexity and cost |
| Sequential pipeline | Fixed order of agents | Simple, predictable | Too rigid for open-ended strategy discussions |
| Decentralized handoffs | Agents hand off control peer-to-peer (Swarm) | Conceptually elegant, no central bottleneck | Easy to lose global view and re-enter loops |

### 2.2 Recommendation for LUMA ADHD

For an 8–15 agent persistent strategy room, the best compromise is:

- **Primary topology**: **Supervisor pattern with limited hierarchy**.[web:27][web:32][web:33]
  - One **Conversation Supervisor** per thread orchestrates speaking turns, thread phase, and termination.
  - For scale (e.g., 12–15 agents), group agents into **2–3 sub-teams** (e.g., Market, Product, Architecture) each with a mini-supervisor that aggregates its team’s view.[web:30][web:32]

- **Occasional decentralized handoffs**:
  - Allow agents to **request** control transfer ("escalate_to_human", "hand_off_to_risk_specialist") but route those requests via the supervisor.
  - This preserves observability and safety while preserving some autonomy.

This design gives you:

- A single accountable place for anti-loop logic and cost control.
- The ability to track and analyze deliberation transcripts per thread.
- Enough flexibility to let agents initiate ideas and reopen threads.

---

## 3. Speaker-selection algorithms

The speaker-selection mechanism controls who speaks next, when, and why. Poor design leads to spamming, dominance, or premature silence. Literature and frameworks suggest several patterns.[web:31][web:27][web:32]

### 3.1 Mechanisms in practice

1. **Supervisor routing (structured output)**
   - Supervisor LLM reads the shared state and chooses the next agent from a limited set using structured output (enum of agent names).[web:31][web:29]
   - This pattern is used in LangGraph’s `create_supervisor()` and custom supervisor graphs.[web:33][web:32]

2. **Round-robin / fixed order**
   - Used in simpler AutoGen `GroupChat` setups, where each agent gets a turn in sequence until termination.[web:19]
   - Works for symmetric roles but tends to be costly and repetitive.

3. **Event-driven activation**
   - AutoGen Core and modern frameworks support event-driven agents that react to messages or external events rather than a global loop.[web:10][web:14]
   - Useful for letting only relevant agents wake up on new information.

4. **Debate scheduling & voting**
   - Multi-agent debate papers define structured debate loops (opening statements → rebuttals → self-adjustment → voting) with turn-taking per role.[web:40]

### 3.2 Practical speaker-selection algorithm

For LUMA ADHD, implement a **hybrid supervisor-controlled, relevance-scored scheduling**:

- **Step 1: Candidate set**
  - At each step, the Conversation Supervisor computes a small set (3–5) of candidate agents based on:
    - **Relevance score**: cosine similarity between the latest message (or topic embedding) and each agent’s expertise vector (manually defined and stored in metadata).[web:45][web:53]
    - **Phase role needs**: certain phases prefer certain roles (e.g., exploration favors ideators; synthesis favors synthesizers).
    - **Silence quotas**: deprioritize agents that spoke recently.

- **Step 2: Supervisor selection with structure**
  - The supervisor LLM is given: current phase, recent transcript summary, candidate list (with scores and last-spoke timestamps), and is asked to pick **one** agent or terminate, via structured output:

  ```json
  {
    "next_agent": "risk_critic | visionary | synthesis_chair | NONE",
    "reason": "...",
    "phase_transition": "stay | advance | rollback"
  }
  ```

- **Step 3: Probabilistic tie-breaking & diversity**
  - Optionally, when multiple candidates are close in score, sample among them with a small temperature to promote diversity, but constrain max consecutive turns for any one agent.

- **Step 4: Event triggers**
  - Separate from the normal turn loop, schedule **events**:
    - New external data ingested.
    - Human comment added.
    - Time-based trigger (e.g., thread idle for 24h).
  - These events set a `wake_reason` flag that the supervisor uses to decide which agents should react (e.g., evidence agents when new data arrives).

This approach combines relevance, phase-awareness, and diversity while keeping the final decision observable at the supervisor, which is important for debugging and for the frontier model’s later review.[web:27][web:32]

---

## 4. Keeping agents "alive" without spam

### 4.1 Event-driven, not constant chat

Following AutoGen Core and LangGraph patterns, agents should be **event-driven**: they do nothing unless triggered by an event (new message, phase change, new external data, scheduled revisit).[web:10][web:14][web:31]

Design principles:

- **No autonomous free-running loops inside agents**; loops are managed in the graph and supervised by step limits.[web:32][web:28]
- **Explicit wake reasons** in state, such as `"wake_reason": "new_market_data"` or `"phase": "debate"`, to provide context in prompts.
- **Silent intervals**: Agents are encouraged via prompts to remain silent unless they add non-trivial value.

### 4.2 Personality and activity levels

Each agent has a **personality profile** that affects its threshold for speaking:

- Example traits: `assertiveness`, `risk_aversion`, `novelty_seeking`.
- The supervisor uses these as soft constraints when picking the next speaker, but also enforces global rules (e.g., no agent more than 25% of turns).

### 4.3 Scheduled "thinking cycles"

Rather than always-on chatter, schedule regular **thinking cycles** per strategy topic:

- Example: For a given strategy thread, run a 10–20-step cycle once per day, or when significant new information arrives.
- Each cycle progresses the thread state machine (see section 6), then sleeps.

This preserves the "alive" feeling (threads occasionally update themselves) without constant token burn.

---

## 5. Autonomous idea generation mechanisms

Agents must initiate ideas, not only react to human prompts.

### 5.1 Topic backlog and watchlists

Maintain a **Topic Backlog** in long-term memory:

- Items: `topic_id`, `title`, `status` (active, parked, decided), `last_activity`, `priority`, `watch_signals` (e.g., keywords, metrics).[web:45][web:53]
- A dedicated **Sentinel agent** periodically scans external signals (news feeds, product metrics, user feedback) and file updates, mapping them onto topics.

### 5.2 Triggered ideation

When the Sentinel agent detects:

- A new signal with high similarity to an existing topic.
- A cluster of signals forming a new theme.

It can:

- **Reopen** an existing parked topic by appending a message: "New evidence suggests revisiting X".
- **Create** a new topic thread and ask ideation agents to generate initial proposals.

### 5.3 Scheduled exploration threads

Maintain **periodic exploration threads**:

- For example, once per week, run a free-form "opportunity scan" thread where ideator agents generate 5–10 new ideas constrained by LUMA ADHD’s strategy and resource constraints.
- The supervisor quickly triages these and either spawns dedicated threads or discards low-value ideas.

### 5.4 Agent self-selection

As part of their prompts, agents are allowed to add **"proposal" messages** even when not selected to speak, but only via the supervisor:

- Agents can write **"self-nomination" signals** into a lightweight side-channel (e.g., `proposed_contributions` in state) with a short justification.
- The supervisor periodically considers these when selecting the next speaker and may prioritize self-nominating agents if their proposal looks novel.

This preserves autonomy without letting all agents speak at once.

---

## 6. Thread lifecycle model

A clear thread lifecycle helps prevent endless wandering and provides hooks for meta-control.
MetaGPT’s SOP-like workflows and MAD-style debate loops are useful here.[web:18][web:40]

### 6.1 Phases

Use a **finite state machine (FSM)** per thread with the following states:

1. **Exploration**
   - Goal: Collect perspectives, ideas, questions, and initial data.
   - Agents: Visionary, Market analyst, Architect, Risk critic, Historian.
   - Rules: Encourage breadth and novelty; disallow decisions or rankings.

2. **Debate**
   - Goal: Stress-test a subset of promising ideas.
   - Agents: Optimist, Skeptic, Ethicist, Logician-style roles, similar to Synapse Council’s design.[web:52]
   - Structured sub-phases per candidate idea:
     - Opening statements by proponents.
     - Rebuttals by critics.
     - Self-adjustment and scoring.

3. **Evidence Gathering**
   - Goal: Fill critical knowledge gaps discovered in debate.
   - Agents: Researcher (web / internal), Data analyst, Domain expert.
   - Output: Short evidence pack(s) with citations and risk notes.

4. **Synthesis**
   - Goal: Produce structured options with trade-offs.
   - Agents: Synthesis chair, Writer/editor agent.
   - Output: A **Strategy Brief**: alternatives, pros/cons, risks, and open questions.

5. **Decision**
   - Goal: Recommend a decision; optionally request human approval.
   - Agents: Decision agent (using cheap model), Frontier supervisor for validation.
   - Outcome labels: approved, rejected, human-required, blocked.

6. **Blocked**
   - Condition: Missing critical data, conflicting constraints, or unresolved disagreement beyond allowed cycles.
   - Action: Generate **"requires human"** tasks, log reasons, and park thread until human input arrives.

7. **Human-required**
   - A subtype of Blocked where the system explicitly pings human operators with a concise summary and specific questions.

8. **Parked/Reopened**
   - When decision is made or work is blocked, the thread transitions to **parked** with a clear status and conditions for reopening (e.g., new data about market X).
   - The Sentinel agent (or Frontier supervisor periodically) checks parked threads against new signals and may trigger **reopen**.

### 6.2 Transition logic

- The Conversation Supervisor owns the state transitions, guided by phase-completion conditions:
  - e.g., Exploration ends after at least N non-duplicate ideas and M critiques, or after a step budget is exhausted.
  - Debate ends when stability metrics (see section 9) indicate diminishing returns.
- MetaAgent’s FSM-based approach suggests ensuring each non-final state has clear outgoing transitions and that loops are bounded by step counts.[web:48]

---

## 7. Memory architecture

Persistent, searchable deliberation requires careful memory layering. Recent work on LLM memory and LangGraph’s memory abstractions provide a blueprint.[web:41][web:42][web:43][web:44][web:45][web:53]

### 7.1 Layers

1. **Short-term context (per-thread)**
   - Implemented via LangGraph-style **checkpointers** keyed by `thread_id` (strategy topic/session).[web:41][web:51]
   - Stores: recent messages, current phase, loop counters, per-phase summaries.
   - Not all history is loaded into context every step; instead, use:
     - Sliding window over recent messages.
     - Hierarchical summaries for older segments.[web:47]

2. **Conversation summaries (hierarchical)**
   - Maintain concise summaries at different granularities: per-phase, per-cycle, overall.[web:47]
   - Use these as context instead of raw transcripts beyond a certain length.

3. **Long-term episodic memory**
   - Episodic memory stores **interaction episodes**: decisions, debates, incidents, and strategies, each with metadata (topic, date, agents, outcomes).[web:42][web:45]
   - Backed by a vector-capable store (Redis, Mongo, PostgreSQL + embeddings).[web:44][web:50][web:54]

4. **Semantic memory / institutional knowledge**
   - Compressed, abstract knowledge distilled from episodes: "LUMA ADHD historically overestimates feature scope in Q4" or "Iranian SME buyers prefer flexible monthly pricing".
   - Derived via periodic summarization jobs; stored as JSON documents with semantic embeddings and tags.[web:42][web:45][web:53]

5. **Decision memory**
   - Structured **Decision Records** (like ADRs): problem, options, decision, rationale, evidence citations, date, and owner (agent/human).
   - Indexed by topic and referenced by future threads; integrated with RAG.[web:53][web:50]

6. **Agent-specific memories**
   - Each agent has a small, private memory namespace for its own heuristics and preferences (e.g., the Skeptic remembers past risk patterns).[web:45][web:53]
   - Implemented via separate namespaces in the store (e.g., `("agent", "skeptic")`).

7. **Shared institutional memory**
   - A shared namespace (e.g., `("org", "strategy")`) for facts and patterns every agent can access.[web:45][web:44]

### 7.2 Retrieval strategy

Following best practices in long-term memory research and LangGraph integrations:[web:42][web:45][web:44][web:54]

- Before each step, the supervisor (or a pre-hook) retrieves:
  - Recent messages (short-term context).
  - Relevant episodic memories and decisions via semantic search using the latest topic or question.[web:44][web:45][web:53]
  - Agent-specific memories for the selected agent.
- Use a **consistency-aware scoring** function combining semantic similarity, recency, and contradiction penalties, inspired by long-term memory architectures.[web:42]

### 7.3 Private vs public scratch space

- Each agent gets two channels:
  - **Public messages**: visible to all agents and persisted in transcripts.
  - **Private scratch**: internal notes in the state, not exposed to others or humans unless explicitly promoted.
- LangGraph’s ability to define custom state schemas and subgraphs allows you to separate these cleanly.[web:31][web:32]

This separation reduces confusion and allows agents to perform internal planning without polluting shared context.

---

## 8. Cheap models plus frontier supervisory model

### 8.1 Behavior of weaker models in multi-agent setups

Studies on multi-agent debate and hallucination propagation show that additional agents reduce hallucinations only when they are strong enough and diverse; weak agents can amplify errors or engage in redundant debate.[web:36][web:40][web:37]

Observed patterns:

- **Groupthink**: Similar models trained on similar distributions tend to converge rapidly on incorrect but plausible answers.
- **Echoing**: Agents repeat or paraphrase each other, causing hallucination snowballing when unsupported claims are accepted as facts.[web:37]

### 8.2 Frontier supervisor role

Use a strong frontier model (e.g., top-tier GPT/Claude equivalent) in a **periodic supervisory role** rather than for every step:

Key responsibilities:

1. **Phase audits**
   - At the end of Exploration, Debate, and Synthesis phases, the frontier model reviews a compressed transcript and key artifacts.
   - Tasks:
     - Detect unsupported claims.
     - Highlight inconsistencies.
     - Flag missing perspectives or unchallenged assumptions.

2. **Decision validation**
   - Before a decision is marked final, the frontier model re-evaluates the Strategy Brief plus evidence attachments and either:
     - Approves.
     - Requests additional evidence.
     - Suggests alternative framing or risk wording.

3. **Hallucination monitoring**
   - Using claim-level decomposition and entailment, approximate the hallucination attenuation/propagation metrics described in recent work.[web:36][web:37]

4. **Meta-learning**
   - Periodically analyze transcripts and outcomes to update agent prompts and heuristics: e.g., adjust the Skeptic agent to focus more on distribution risks than credit risk for LUMA ADHD.

Cost control mechanisms:

- Limit frontier calls to phase boundaries, decisions, and high-impact human notifications.
- Use cheap models for routine speaking turns and local critique.

---

## 9. Measuring informational value of messages

To avoid repetitive agreement and meaningless debates, the system should measure whether a new message actually adds value.

### 9.1 Value metrics

For each candidate message, compute:

1. **Novelty score**
   - Semantic distance between the new message embedding and a window of recent messages + summaries.
   - If below a threshold, consider it redundant.

2. **Contradiction / challenge score**
   - Use NLI/entailment models to detect whether the message contradicts or challenges previous claims.
   - Higher score if it identifies a gap, risk, or refutes a claim.[web:37]

3. **Grounding / evidence score**
   - Count or classify citations to external sources or internal decisions.
   - Higher score if it references evidence (documents, metrics).

4. **Contribution to objectives**
   - LLM-based rubric scoring: e.g., "On a scale 1–5, how much does this message clarify trade-offs or move toward a decision?" (fine-tune or calibrate via eval sets).[web:36]

The Conversation Supervisor can use these scores to decide whether to keep a message, ask the agent to revise, or terminate the phase.

### 9.2 Repetition and circular argument detection

Use techniques from discourse and semantic similarity:[web:47][web:53]

- **Windowed redundancy detection**: For each message, compute similarity to last N messages; if > threshold and no new evidence or angle is given, treat as repetition.
- **Circular argument detection**: Track argument graphs; if the same claim-support pairs reappear with no new nodes, mark the discussion as stalled.
- **Consensus without evidence**: Detect when many agents agree but grounding score is low; supervisor moves thread back to Evidence Gathering instead of Decision.

### 9.3 Stalled discussion detection

A discussion is stalled when:

- Novelty and challenge scores stay below thresholds for K consecutive turns.
- No new evidence or metrics are introduced.
- Agents begin referencing prior summaries without adding content.

In this case, the supervisor may:

- Move to Synthesis with a "partial" label.
- Mark thread as Blocked and request human input.

---

## 10. Awakening quiet discussions

### 10.1 Reopening conditions

Parked threads should be reopened when:

- New external data matches the topic beyond a similarity threshold (via episodic memory search).[web:44][web:50]
- Humans comment or add new goals.
- Periodic review finds that earlier assumptions are now outdated (e.g., market conditions changed).

### 10.2 Sentinel and scheduler

A background **Sentinel agent** periodically:

- Scans new documents / metrics.
- Runs semantic matching against parked topics.
- For matches above a threshold, posts a **reopen suggestion** for the Conversation Supervisor, including a short diff summary.

The Supervisor then either:

- Automatically reopens the thread in Exploration or Evidence Gathering.
- Or queues a human notification asking whether to reopen.

---

## 11. Silence vs continued discussion

Agents should sometimes remain silent; silence is a valid outcome.

### 11.1 Silence rules for agents

Prompts for each agent include:

- "If you cannot add **new evidence, a new perspective, or a substantive critique**, reply with `NO_COMMENT`."
- "Do not restate points already made unless explicitly asked to summarize or if you believe they are being overlooked."

The Supervisor treats `NO_COMMENT` as a participation signal but not as a message to show to others.

### 11.2 Silence rules for the system

The Conversation Supervisor stops a phase or entire thread when:

- All agents in the candidate pool respond with `NO_COMMENT`.
- Novelty and challenge metrics remain low.
- A step or cost budget is exhausted.

Dormant threads are parked; only the Sentinel or humans can wake them per section 10.

---

## 12. Anti-loop mechanisms and groupthink mitigation

### 12.1 Architectural anti-loop controls

- **Graph-level recursion limit**: Use LangGraph’s recursion or step limits per thread to bound total steps.[web:31][web:28]
- **Phase-specific step caps**: e.g., Exploration ≤ 30 messages, Debate per candidate ≤ 20 messages.
- **Loop detection**: If the same agent is routed repeatedly with no progress (no improvement in value metrics), the supervisor is forced to pick a different agent or move to a new phase.[web:28]

### 12.2 Groupthink controls

- **Role diversity**: Ensure agents have genuinely different objectives and prompts, including a dedicated "Devil’s Advocate" or ERIS-like dissent agent inspired by MACI’s ethical adjudication modules.[web:20]
- **Structured dissent**: Periodically trigger a "challenge round" where dissent-oriented agents must articulate strong counterarguments even if they tentatively agree.
- **Evidence thresholds for consensus**: Consensus is only accepted if evidence scores pass a threshold; otherwise move to Evidence Gathering.[web:36][web:37]

### 12.3 Hallucination cascade prevention

- **Grounding checks**: Before adopting a claim into summaries or decisions, run a grounding pass: decompose into atomic claims and check against trusted sources or internal knowledge via retrieval, inspired by hallucination propagation work.[web:36][web:37]
- **Bidirectional entailment clustering**: Cluster claims and evidence to ensure that key conclusions are supported in both directions (claim → evidence and evidence → claim), as suggested by semantic reasoning strategies.[web:37]

---

## 13. Recommended orchestration model for LUMA ADHD

This section synthesizes the above into concrete recommendations.

### 13.1 Conversation state machine

Use a finite state machine per strategy thread with states:

- `exploration`
- `debate`
- `evidence_gathering`
- `synthesis`
- `decision`
- `blocked`
- `human_required`
- `parked`

Transitions are governed by:

- Phase-completion criteria (e.g., minimum ideas, diminishing novelty, evidence thresholds).
- Supervisory meta-decisions (frontier model audits).
- Human interventions (override, approve, or park).

The FSM is implemented at the supervisor node, similar to MetaAgent’s FSM-driven multi-agent systems but adapted for strategic deliberation.[web:48]

### 13.2 Speaker-selection algorithm

- Use a **Supervisor Router** pattern implemented via LangGraph’s `create_supervisor` or equivalent custom node.[web:33][web:32]
- At each step:
  - Compute relevance scores for all agents using embeddings plus simple metadata rules (phase-role alignment, recent activity).[web:45][web:32]
  - Select a candidate set of 3–5 agents.
  - Ask the supervisor LLM (cheap but reliable model) to pick the next speaker (or terminate) with structured output.
  - Enforce diversity constraints (no agent dominates, no repeated turns beyond threshold).

### 13.3 Autonomous idea-generation mechanism

- Implement a **Sentinel agent** that:
  - Monitors external signals and internal logs.
  - Maps signals to existing or new topics.
  - Reopens or spawns threads when triggers fire.
- Maintain a **Topic Backlog** and schedule regular **exploration sessions** where ideation agents generate new proposals.
- Allow agents to use a `self_nomination` side-channel to propose contributions; the supervisor may choose them as next speakers when appropriate.

### 13.4 Recommended memory layers

- **Short-term**: Per-thread checkpointer storing message history and current FSM state.[web:41][web:51]
- **Hierarchical summaries**: Phase-level and overall summaries used in prompts instead of full history.[web:47]
- **Long-term episodic memory**: Vectorized episodes (debates, incidents, decisions) with semantic search, likely using Redis, Mongo, or Postgres plus LangGraph Store.[web:44][web:50][web:53]
- **Semantic institutional memory**: Abstracted patterns and lessons stored as structured documents, retrievable via semantic search with consistency-aware scoring.[web:42][web:45]
- **Decision memory**: ADR-style records, linked from episodic memory and used heavily in retrieval during new threads.
- **Agent-specific and shared namespaces**: Private scratch and organization-level knowledge via stores.[web:45][web:53]

### 13.5 Anti-loop mechanisms

Implement multiple layers:

- Graph-level recursion and step limits per thread and per phase.[web:31][web:28]
- Value metrics (novelty, challenge, evidence) to detect stalled discussions.
- Repetition detection using semantic similarity over a sliding window.[web:47][web:53]
- Groupthink mitigation via dedicated dissent roles and evidence thresholds.
- Hallucination cascade prevention via claim decomposition, grounding, and entailment clustering.[web:36][web:37]

### 13.6 Rules for silence vs continued discussion

- Agents return `NO_COMMENT` when they cannot add new value; supervisor doesn’t count this as a visible message.
- A phase ends when:
  - All candidate agents vote `NO_COMMENT`, **or**
  - Novelty/challenge metrics stay low for K turns, **or**
  - Step or cost budget exceeded.
- Threads are parked (with clear status) and only reawakened by Sentinel triggers or human intervention.

### 13.7 Role of the supervisory frontier model

- **Audit and calibration**:
  - Periodic reviews of threads at phase boundaries.
  - Detect hallucinations, missing perspectives, and brittle reasoning.[web:36][web:37][web:40]
- **Decision gate**:
  - Validate final decisions and Strategy Briefs before they become institutional facts.
- **Meta-learning and governance**:
  - Analyze logs to adjust prompts, agent roster, phase thresholds, and memory retention rules.
  - Act as an ethical and risk-aware overlay, similar to MACI’s governance agents.[web:20]

The frontier model is thus a **high-level auditor and governor**, not a day-to-day participant, making its cost manageable while significantly improving reliability.

---

## Sources

- AutoGen: multi-agent conversation framework, layered architecture, actor model.[web:10][web:11][web:14][web:19][web:21][web:24]
- CAMEL: role-playing agents and inception prompting; failure modes in multi-agent cooperation.[web:12][web:16][web:17]
- MetaGPT: SOP-driven multi-agent collaboration and assembly-line paradigm.[web:18]
- LangGraph: multi-agent patterns, supervisor routing, state graphs, memory and checkpointers.[web:31][web:25][web:27][web:28][web:29][web:32][web:33][web:35][web:30]
- Memory for agents: LangGraph memory, Redis, MongoDB, and analyses of episodic vs semantic memory for LLMs.[web:41][web:44][web:45][web:47][web:53][web:50][web:54][web:51][web:49][web:43][web:42]
- CrewAI: multi-agent processes (Sequential, Hierarchical, Consensual, Flows).[web:38][web:39]
- Swarm and OpenAI Agents concepts: handoffs, routines, context variables, decentralized orchestration.[web:46]
- Multi-agent debate and hallucination dynamics: MAD studies, hallucination propagation metrics, and snowball mitigation.[web:40][web:36][web:37]
- Synapse Council: state-machine-based debate engine with specialized personas (optimist, skeptic, ethicist, logician).[web:52]
- MetaAgent: FSM-based automatic multi-agent construction and transition design.[web:48]
