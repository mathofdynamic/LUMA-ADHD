# Phase 06 — Admin Panel

Turn the admin shell into the primary observability/control interface for LUMA ADHD. It must feel like watching a living strategy organization, not a generic CRUD dashboard.

## Visual direction

Use a refined dark LUMA visual system with restrained violet/magenta accents, excellent typography and spacing, clear hierarchy, subtle purposeful motion, responsive layouts, accessible contrast/focus, and reduced-motion support. Avoid template-looking cards, excessive gradients, fake analytics, and decorative animation that hides information.

## Required areas

### Strategy Room
Show current organization state, active/quiet agents, important active threads, recent meaningful activity, pending human tasks, latest GOD review, and system warnings. Prioritize what needs human attention over raw message volume.

### Agents
Agent roster and detail view: identity, specialty, Soul, personality, interests, status, Rank/domain scores, recent participation, files, and evaluation history. Allow authorized edits and pause/resume.

### Threads
Filterable lifecycle board/list plus detailed chronological conversation view, participants, phase/state, summaries, related files, decisions, human tasks, and activity budget. Support manual close/park/reopen/continue actions.

### Files & Knowledge
Browse/search Markdown files, revisions, ownership, references, and cached official LUMA knowledge with provenance.

### Human Tasks
Queue of requested human input with priority, reason, blocking status, related thread, response, and resolution state.

### Reputation
Rank table, domain breakdown, historical changes, and the evidence/events responsible for changes. Make the system explainable rather than gamified.

### GOD
Latest review, historical reviews, directives, affected threads, and manual review action.

### System
Due/running/failed jobs, provider usage metadata, scheduler status, Telegram delivery state, D1/Queue budget indicators, errors, and audit events.

### Settings
Editable system guardrails and agent activity settings with validation and clear descriptions.

## Data behavior

Use real backend endpoints; no fake production data. Add loading, empty, stale, partial-error, and retry states. Lists need pagination or bounded queries. Mutations should show clear success/failure and refresh affected state.

Implement internal admin authentication appropriate for a private operator panel, with expiring sessions and an audit record for privileged changes. Do not ship default credentials.

## Tests and acceptance

Add component/route tests for critical views and mutation flows. Validate mobile/tablet/desktop behavior and keyboard navigation.

Phase is complete when an operator can understand what the agents are doing, inspect why, find failures, edit agent configuration, manage threads/human tasks, inspect reputation/GOD history, and monitor free-tier pressure without opening D1 manually.