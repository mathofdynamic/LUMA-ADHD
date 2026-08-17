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

Direct address is deterministic for the first turn. Exploration is restricted
to the top relevant pool and is never a roster rotation. An irrelevant quiet
Agent remains quiet. A neglected relevant specialist receives a chance when the
relevance difference is modest.

## Cross-job activity

`agent_turns` is the canonical opportunity record. Runtime selection reads one
bounded, indexed activity aggregate for the active normal Agents. It includes
recent organization and thread counts, last turn time, ambient opportunity
time, and completed non-`WAIT` contribution counts. The current burst still
uses its local recency list for immediate consecutive-turn protection.

Selection telemetry stores only compact scores, high-level reasons, bounded top
candidates, and recency/exploration signals. It does not store hidden model
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
