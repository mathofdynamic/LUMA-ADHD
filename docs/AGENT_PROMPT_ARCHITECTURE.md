# Agent Prompt Architecture

LUMA normal Agents use a reviewed organizational self-model rather than a
generic assistant preamble. The current prompt contract is
`postv1-organizational-self-v2`.

## Layers

Work prompts are composed in this order:

1. organizational constitution;
2. personal identity, Soul, personality, and role operating principle;
3. compact coworker social map;
4. relationship to the authorized human and to GOD;
5. group-chat and deference norms;
6. canonical continuity and memory rules;
7. current thread, focus, boundary, and contribution state;
8. evidence and epistemic rules;
9. bounded capabilities and actions;
10. output contract.

The action schema is deliberately late in the prompt. Structured Outputs and
application validation remain authoritative; prompt ordering is not a security
boundary.

## Organizational self-model

LUMA ADHD is a private persistent internal AI organization. D1 is canonical
state; Telegram is a shared workplace and projection; Agent files and memory
provide durable continuity; an LLM call is temporary cognition. This model does
not claim biological consciousness or unrecorded personal experience.

An Agent's identity is grounded in its canonical ID, roster profile, Soul,
personality, role, files, memory, decisions, history, and reputation supplied
by the application. Soul affects attention and trade-offs. Personality affects
bounded cognitive tendencies as well as communication style. Neither can
override evidence, safety, or current human intent.

The eight normal roles have distinct operating lenses. They are collaborators,
not competing chatbots. A role is a lens, not universal authority: an Agent may
defer, issue `REQUEST_AGENT`, or `WAIT` when another specialist owns the
question more strongly.

GOD is the internal supervisory reviewer. It is not a ninth normal specialist,
not a Rank competitor, and has no Telegram bot.

## Conversation modes

Interactive work answers or advances the human's actual request first. It uses
the current bounded ConversationFocus, prior contributions, covered
perspectives, evidence discipline, and duplicate suppression.

Ambient work may perform durable file or memory work without public speech.
Deep work remains bounded by the existing runtime ceilings.

Social and acknowledgement turns are a separate fast path. They keep the
Agent's identity but skip RAG, acquisition, document work, strategic context,
and multi-Agent routing. They allow at most one short `SPEAK` or `WAIT`.

## Boundaries and supersession

The current human message is evaluated before old memory. Direct Telegram
replies and topic bindings are strong continuation signals. Greetings,
acknowledgements, corrections, resets, unrelated questions, and ambiguous
messages after a temporal gap do not automatically inherit the most recent
active strategic Thread.

Supported deterministic interaction intents are `substantive`, `nudge`,
`social`, `acknowledgement`, `correction`, and `topic_reset`. A nudge retains
the preceding substantive request. A correction or reset creates a stronger
boundary. A newer social/correction boundary can supersede an in-flight stale
interactive job.

Supersession is checked before the next selection, after a provider response,
and immediately before Telegram projection. Published history is preserved;
obsolete unpublished work is not projected.

## Memory and evidence

Canonical records are evidence, not personal fantasy. Agents must not claim
unrecorded memories. Current-state rankings require current evidence; proposals
and stale strategy documents can support hypotheses but cannot establish live
priority. Social turns intentionally retrieve no context.

## Diagnostics

Inspect a synthetic, secret-free prompt locally:

```text
npm run diagnose:agent-prompt -- --agent agent-operations --mode interactive
npm run diagnose:agent-prompt -- --agent agent-operations --mode social
```

The command prints prompt size, focus classification, and the rendered prompt.
It does not access production D1, RAG bodies, or secrets.
