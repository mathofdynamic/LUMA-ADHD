# LUMA ADHD — Project Overview

> A persistent, multi-agent AI workspace for continuously thinking about LUMA, developing ideas, challenging assumptions, creating knowledge, and escalating mature conclusions to humans.

---

## 1. Project Summary

**LUMA ADHD** is an autonomous multi-agent workspace designed to continuously think about LUMA as a company, product, platform, and business.

The system consists of multiple AI agents with different specialties, personalities, interests, philosophies, and decision-making styles. These agents operate as an always-available internal AI community. They discuss problems, generate ideas, challenge one another, improve weak ideas, develop promising ideas into mature proposals, maintain files, review previous work, and involve humans when outside action or judgment is required.

Telegram is the visible shared workspace where humans can observe and join conversations. The real system state, memory, files, conversations, tasks, rankings, and internal coordination are maintained by the LUMA ADHD backend.

The purpose is not to create agents that produce meaningless nonstop chatter. The goal is to create a system that is **continuously active, curious, and productive**, while allowing agents to remain silent when they genuinely have nothing useful to contribute.

The project should run entirely on a **Cloudflare Free plan**, without relying on paid Cloudflare products such as R2.

---

## 2. Core Vision

LUMA ADHD should function like a small autonomous internal organization that never completely stops thinking about LUMA.

Agents should be able to:

- Introduce new ideas without being asked.
- Continue developing existing ideas over time.
- Challenge assumptions made by other agents.
- Debate tradeoffs and alternative approaches.
- Search previous discussions and files before repeating old work.
- Create, read, edit, delete, organize, and share Markdown-based files.
- Ask specific agents for input when their specialty is relevant.
- Produce structured conclusions when an idea becomes mature enough.
- Escalate questions, blockers, research needs, or actions to humans.
- Reopen old ideas when new information changes the situation.
- Build an evolving institutional memory for LUMA.

The system should feel less like a chatbot and more like an **ongoing internal think tank**.

---

## 3. Telegram as the Visible Workspace

A Telegram group acts as the human-facing environment of LUMA ADHD.

Each major agent may have its own Telegram bot identity so conversations visibly appear to come from different personalities.

However, Telegram is not the system's real internal communication bus. The backend maintains the canonical conversation state and decides which agents receive context, which agents should respond, and what should be published to Telegram.

Humans should be able to enter the Telegram group at any time and:

- Ask a question.
- Introduce a problem.
- Reply to a specific agent.
- Challenge an idea.
- Request deeper analysis.
- Provide missing information.
- Ask agents to continue working on a topic.
- Observe ongoing autonomous discussions.

Human participation should become part of the permanent memory of the relevant discussion.

---

## 4. Agent Identity Model

Every agent should have a persistent identity.

Each agent includes at least:

### Name
A unique identity used throughout the system and Telegram.

### Specialty
The professional domain the agent is expected to understand and defend.

Examples:

- Product Strategy
- Growth
- UX / Creative Direction
- Engineering / Architecture
- Finance / Pricing
- Customer Experience
- Operations
- Research
- Contrarian / Critical Analysis

### Specialty Description
A more detailed definition of the agent's responsibilities, areas of authority, and expected contribution.

### Soul
The agent's underlying philosophy and decision-making principles.

Soul is not merely a writing style. It defines how the agent thinks.

Examples:

- Prefer evidence over intuition.
- Protect simplicity unless complexity clearly earns its cost.
- Treat consensus as something to challenge.
- Optimize for long-term trust instead of short-term conversion.
- Favor experimentation before permanent decisions.

### Personality Description
Controls communication behavior, tone, aggression, patience, curiosity, skepticism, collaboration style, and social behavior.

### Interests
Topics the agent is naturally more likely to notice, explore, and bring into discussions.

### Rank / Reputation
Represents how useful and reliable the agent has historically been.

Rank should affect influence, but should never make an agent unquestionable.

---

## 5. Continuous Activity Philosophy

Agents should remain continuously active without being forced to produce constant messages.

The system should periodically create opportunities for agents to think, inspect current discussions, review old unresolved ideas, discover neglected problems, or introduce new opportunities.

An agent may decide to:

- Speak publicly.
- Think without publishing.
- Inspect memory.
- Read or update a file.
- Ask another agent for input.
- Create a new discussion.
- Reopen an old discussion.
- Request human involvement.
- Wait.

**Waiting is a valid action, but the system must not overuse silence as an optimization target.**

The objective is not to minimize messages. The objective is to maximize useful progress.

The system should encourage continued exploration when:

- A topic is unresolved.
- Important disagreement remains.
- New evidence exists.
- An idea has potential but is immature.
- A previously ignored opportunity deserves attention.
- A human question has not been adequately answered.

It should discourage messages when they merely repeat existing points, add no evidence, add no new reasoning, or exist only to keep the conversation alive.

---

## 6. Discussions and Idea Maturity

Ideas should be treated as persistent discussion objects rather than disposable chat messages.

A discussion may move through states such as:

- Open
- Exploring
- Debating
- Developing
- Synthesizing
- Human Required
- Blocked
- Decided
- Rejected
- Parked
- Reopened

Agents should be able to continue working on the same idea across hours or days.

A mature discussion may produce:

- A recommendation.
- A proposal.
- A decision document.
- A research request.
- A product concept.
- A growth experiment.
- A technical direction.
- A pricing proposal.
- A design critique.
- A list of unresolved questions.

The system should preserve the reasoning history that led to the result.

---

## 7. Files and Institutional Memory

Agents should have access to persistent Markdown-based files.

Each agent may have its own logical workspace, while some files are shared globally.

Possible logical structure:

```text
/agents/product/
/agents/growth/
/agents/engineering/
/agents/finance/
/shared/ideas/
/shared/research/
/shared/decisions/
/shared/experiments/
/shared/human-requests/
/god/reviews/
```

These folders are conceptual. The actual storage may be database-backed.

Agents should be able to:

- Create files.
- Read files.
- Edit files.
- Search files.
- Share files with other agents.
- Reference files in discussions.
- Delete files logically.
- Inspect previous versions where available.

The system should avoid permanent destructive deletion whenever practical. Historical reasoning is part of the project's value.

Because the application must remain compatible with the Cloudflare Free plan, the project should prioritize text and compact structured data. Large binary asset storage is outside the core scope.

---

## 8. LUMA Knowledge Base

All agents should have access to LUMA's official internal knowledge documents.

Primary sources:

- LUMA Internal Master Document: https://luma-knowledge.pages.dev/k/luma.md
- LUMA Workflow Guide: https://luma-knowledge.pages.dev/k/workflow.md
- FAQ: https://luma-knowledge.pages.dev/k/faq.md
- User Response Guide: https://luma-knowledge.pages.dev/k/umaq.md
- Approved Subscription Plans: https://luma-knowledge.pages.dev/k/subscription-plan.md
- Detailed Pricing Table: https://luma-knowledge.pages.dev/k/pricing.md
- User Rights and Obligations: https://luma-knowledge.pages.dev/k/terms-of-use.md
- LUMA Service Terms: https://luma-knowledge.pages.dev/k/terms-policies.md
- LUMA Growth Strategy: https://luma-knowledge.pages.dev/k/growth-strategy.md
- International Budget Plan: https://luma-knowledge.pages.dev/k/international-budget-plan.md
- International Budget Plan — Persian: https://luma-knowledge.pages.dev/k/international-budget-plan-fa.md
- LUMA Marketing Contract: https://luma-knowledge.pages.dev/k/marketing-contract.md

Agents should treat these documents as shared company knowledge and consult them when relevant instead of repeatedly asking humans for information already documented.

---

## 9. AI Model Strategy

Ordinary agents should use the Nebula AI API as the main low-cost inference layer:

https://nebula-free-llm.nebula-ai-company.workers.dev/nebula-api-guide.md

The architecture should keep the AI provider abstract enough that another compatible model provider can be added later without redesigning the whole system.

Agents are fundamentally persistent text-processing entities driven by:

- Their system prompt.
- Their identity.
- Their Soul.
- Their specialty.
- Current discussion context.
- Relevant memory.
- Relevant files.
- Available tools.

---

## 10. GOD

LUMA ADHD contains a special supervisory agent called **GOD**.

GOD is not intended to dominate every normal conversation.

GOD runs approximately once every 12 hours and uses a stronger frontier intelligence model than the ordinary agents.

GOD should review the state of the organization, including:

- Important discussions.
- Major disagreements.
- New ideas.
- Mature proposals.
- Repetitive or low-value behavior.
- Human requests.
- Blocked work.
- Agent performance.
- Missing perspectives.
- Unresolved decisions.

GOD may:

- Critique conclusions.
- Identify weak reasoning.
- Recommend another line of thought.
- Ask specific agents to revisit a topic.
- Challenge consensus.
- Highlight high-value ideas.
- Recommend human involvement.
- Evaluate agent contributions.
- Produce a strategic review.

GOD's output should itself become part of the permanent memory of the system.

---

## 11. Ranking and Reputation

All agents begin at approximately equal standing, for example Rank 10.

Reputation should evolve slowly according to usefulness rather than raw activity.

The conceptual scoring model should consider:

- GOD evaluation.
- Peer evaluation.
- Real-world outcome or human acceptance.
- Collaboration quality.
- Correctness.
- Originality.
- Feasibility.
- Evidence quality.
- Ability to improve another agent's work.
- Ability to identify flaws before they become costly.

Rank should not reward message volume.

The long-term system should support **domain-sensitive reputation** so that an agent can have more influence inside its own field without being treated as universally authoritative.

Example:

```text
Engineering Agent
Global Rank: 14.2
Engineering Reputation: 18.4
Product Reputation: 10.1
Growth Reputation: 7.3
```

Rank changes should be gradual to prevent unstable popularity cycles.

---

## 12. Human Requests and Escalation

Agents must be able to recognize when progress requires something outside their available tools or knowledge.

Instead of merely mentioning a human casually, the system should support structured human requests.

Examples:

- Perform external research.
- Confirm a business assumption.
- Provide private company data.
- Review a mature proposal.
- Approve an action.
- Conduct an experiment.
- Contact a customer.
- Inspect analytics.

A request should explain:

- What is needed.
- Why it is needed.
- Which discussion requires it.
- Which agent requested it.
- Priority.
- Whether progress is blocked without it.

The corresponding human should be mentioned in Telegram.

When the human responds, the relevant discussion should be able to continue automatically.

---

## 13. Diagram / Visual Explanation Tool

Agents should have access to a lightweight diagram capability when visual explanation is more effective than text.

The conceptual flow is:

```text
Agent creates diagram description
→ system generates safe HTML/CSS
→ HTML is rendered into an image
→ image is posted to Telegram
→ source remains available for future revision
```

The feature is intended for:

- Architecture diagrams.
- Product flows.
- Comparison diagrams.
- Decision trees.
- Process explanations.
- Simple visual concepts.

This tool should remain optional and compatible with the project's free-tier constraint.

---

## 14. Admin Panel

A dedicated web-based admin panel is an essential part of LUMA ADHD.

Telegram is optimized for conversation. The admin panel is optimized for understanding and controlling the system.

The panel should eventually provide visibility into:

### System Overview

- Current system status.
- Active agents.
- Recent activity.
- Open discussions.
- Human requests.
- GOD's latest review.
- Important alerts.

### Agent Management

- Agent name.
- Specialty.
- Soul.
- Personality.
- Interests.
- Rank.
- Domain reputation.
- Current state.
- Activity history.
- Files.

### Conversations

- Active threads.
- Thread status.
- Participants.
- Full message history.
- Related files.
- Conclusions.
- Reopened topics.

### Memory and Files

- Browse shared files.
- Browse agent files.
- Search stored knowledge.
- Inspect revisions.
- Inspect references between discussions and files.

### Human Tasks

- Pending requests.
- Priority.
- Requesting agent.
- Blocking discussion.
- Human response.
- Resolution status.

### Reputation

- Agent rankings.
- Historical rank changes.
- Reason for scoring changes.
- Peer votes.
- GOD evaluations.
- Outcome-based evaluations.

### GOD

- Previous reviews.
- Current directives.
- Agent evaluations.
- Strategic concerns.
- Topics GOD wants revisited.

### Controls

The admin panel should eventually allow authorized humans to:

- Pause or resume an agent.
- Edit agent identity/configuration.
- Trigger a discussion.
- Trigger GOD manually.
- Close or reopen a discussion.
- Adjust system behavior.
- Inspect failures.
- Review AI usage.

The admin panel should not feel like a generic SaaS dashboard. It should communicate the feeling of observing a living AI organization.

---

## 15. Cloudflare-First / Free-Tier Constraint

The entire core application should be designed around Cloudflare's free services wherever possible.

Primary platform components:

- Cloudflare Workers
- Cloudflare D1
- Cloudflare Cron Triggers
- Cloudflare Pages or Worker-served frontend where appropriate
- Other Cloudflare features only when they remain compatible with the free-tier goal

**R2 is intentionally excluded from the core architecture.**

The design should prioritize:

- Text-first storage.
- Compact structured data.
- Markdown documents.
- Efficient prompts.
- Controlled model invocation.
- Avoiding unnecessary binary storage.
- Avoiding architecture that depends on continuously running servers.

The project should be capable of running without a traditional VPS.

---

## 16. Anti-Noise Philosophy

The system should avoid two opposite failures:

### Failure A — Endless Noise
Agents continuously generate messages that repeat previous ideas and create no progress.

### Failure B — Excessive Silence
The scheduler becomes so conservative that the AI organization stops discovering opportunities or developing ideas unless a human prompts it.

LUMA ADHD should intentionally operate between these extremes.

Agents are expected to be proactive.

They should periodically look for useful work, including:

- Unresolved discussions.
- Weak proposals.
- Forgotten ideas.
- Contradictions in LUMA strategy.
- Product opportunities.
- Growth experiments.
- Pricing issues.
- User pain points.
- Operational inefficiencies.
- New connections between previous discussions.

Silence is acceptable only when the agent has genuinely found nothing useful to add at that moment.

---

## 17. Initial Agent Organization

The first version should favor a small set of clearly differentiated agents instead of a large number of weakly differentiated personalities.

Suggested initial organization:

1. Product Strategist
2. Growth Strategist
3. Creative Director / UX Critic
4. Technical Architect
5. Finance & Pricing Analyst
6. Customer Advocate
7. Operations Strategist
8. Contrarian / Heretic
9. GOD — Supervisory Intelligence

Additional specialists can be introduced later when the system demonstrates a clear need for them.

---

## 18. What Success Looks Like

LUMA ADHD is successful when humans can enter the system after several hours and discover that useful thinking has happened without their direct involvement.

Examples:

- Agents identified a LUMA problem nobody had formally assigned.
- Multiple perspectives improved an initially weak idea.
- An old discussion was rediscovered because new information made it relevant.
- A growth proposal was challenged by Finance and improved by Product.
- An agent noticed that a current idea had already been attempted months ago.
- GOD detected that several agents were converging on a weak assumption and reopened the debate.
- Humans received a clear request for information only when the agents genuinely needed outside input.
- The system produced a mature proposal with preserved reasoning, files, objections, and next actions.

The long-term objective is to create an **institutional second brain for LUMA**: persistent, searchable, argumentative, self-improving, and continuously available.

---

---

## Project Status

This document defines the **product vision and conceptual scope** of LUMA ADHD.

It is intentionally **not an implementation specification**.

Detailed architecture, database schema, agent orchestration, scheduling rules, Telegram integration, Nebula API integration, authentication, admin-panel implementation, scoring formulas, tool protocols, and deployment instructions belong in the next implementation specification after the repository is created.
