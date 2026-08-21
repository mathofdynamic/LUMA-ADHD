# Agent Selection and Autonomy

LUMA treats autonomous work as bounded opportunities, not as a requirement to
produce Telegram messages. A selected Agent turn counts as an opportunity even
when the result is `WAIT`, `FILE_WORK`, `REQUEST_HUMAN`, or a safe structured
output failure. Durable file or memory work is meaningful activity; public
speech is only one possible projection.

## Selection layers

Eligibility and relevance are evaluated first:

- explicit human address and Agent requests;
- specialty, interests, normalized Persian/English lexical relevance;
- thread phase fit and useful workspace context.

Selection then applies bounded policy signals:

- current-burst and same-thread recency;
- recent organization-wide opportunities;
- bounded domain reputation;
- a small candidate-specific exploration value;
- a capped neglected-opportunity boost for relevant Agents with little recent opportunity.

Interactive human discussions use a stricter relevance gate than ambient work.
An open-thread phase is a ranking hint, not enough by itself to make a normal
Agent relevant to a human's question. If no topic signal can be extracted at
all, one explicitly marked phase fallback may keep a malformed/very short
request observable; it never competes with a real specialist match. Ambient
work may use phase fit to find a useful opportunity after the scheduler has
confirmed that the Agent-level interval is due.

Interactive turns build a bounded `ConversationFocus` from the latest
substantive human request, thread objective, current human nudge intent, the
latest meaningful contribution, and the unresolved question. A reply such as
"کسی نیست جواب منو بده؟" therefore retains the preceding question instead of
becoming the retrieval query. Focus is rebuilt after each completed turn.

Conversation boundaries are deterministic. Greetings and acknowledgements use
a one-turn social fast path; corrections and topic resets supersede stale
interactive work. Direct Telegram replies and topic bindings continue their
target thread, while an ambiguous message after a temporal gap does not blindly
reuse the most recent active strategy thread. The runtime checks for a newer
superseding human boundary before selection, after the provider response, and
before Telegram projection.

For broad cross-functional questions, selection tracks covered domains such as
`product_strategy`, `customer_experience`, `engineering_architecture`, and
`finance_pricing`. An uncovered relevant perspective gets a small bonus and an
already-covered perspective gets a small penalty. This is coverage-aware
routing, not round-robin participation. Explicit address and valid
`REQUEST_AGENT` signals remain stronger.

Every selected Agent receives a distinct-contribution instruction. It should
answer the human first, add a materially new perspective or evidence, challenge
a weak assumption, synthesize when useful, or return `WAIT`. Bounded lexical
concept overlap suppresses a semantic restatement before public projection.

Current-state rankings require current evidence. Future plans and proposals
can support hypotheses, but cannot establish claims such as "the three main
current problems" without measured signals, decisions, or comparable durable
evidence. Unsupported ranking language is qualified and its evidence state is
stored in turn metadata.

Direct address is deterministic for the first turn. Exploration is restricted
to the top relevant pool and is never a roster rotation. An irrelevant quiet
Agent remains quiet. A neglected relevant specialist receives a chance when the
relevance difference is modest.

`REQUEST_AGENT` is a one-shot routing hint, not permanent authority. Interactive
bursts ignore requests created before the current human wake/anchor, and a
requested Agent's selected turn marks the matching open request as accepted.
This preserves useful specialist handoffs without allowing an old request to
bias later work indefinitely.

## Cross-job activity

`agent_turns` is the canonical opportunity record. Runtime selection reads one
bounded, indexed activity aggregate for the active normal Agents. It includes
recent organization and thread counts, last turn time, ambient opportunity
time, and completed non-`WAIT` contribution counts. The current burst still
uses its local recency list for immediate consecutive-turn protection.

Selection telemetry stores only compact scores, high-level reasons, bounded top
candidates, perspective/coverage signals, conversation-focus keys, grounding
state, and duplicate-suppression state. It does not store hidden model
reasoning or full candidate dumps.

## Ambient autonomy

The scheduler still chooses at most `schedulerWorkPerTick` quiet threads and
does not create one job per Agent. It attaches one preferred relevant Agent
hint to each coarse ambient job. Runtime validates the hint against the same
selection policy, so a stale or irrelevant hint cannot bypass eligibility.

The ambient interval describes when a quiet thread may receive an opportunity.
Agent-level opportunity balancing is applied during final candidate selection.
Daily ambient budgets and hard runtime ceilings remain authoritative.

## Diagnosis

Use the operator-only diagnostic command when Wrangler access is available:

```text
npm run diagnose:agent-activity -- --remote
```

It prints bounded counts for opportunities, `SPEAK`, `WAIT`, failures, durable
work, and last activity. The Admin Agents view exposes the same distinction.
No public diagnostic route is created.

The first post-v1 production diagnosis found a combination of direct customer
addressing, same-thread ambient repetition, thread-centric scheduler eligibility,
the former shared-random exploration bug, broad open/exploring phase fit, and
structured-output failures. These signals are corrected independently so one
high-ranked Agent cannot monopolize autonomous opportunities while relevant
specialists remain eligible.
