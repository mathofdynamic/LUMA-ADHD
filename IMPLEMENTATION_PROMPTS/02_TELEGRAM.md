# Phase 02 — Telegram Integration

Implement the project’s **private, configured LUMA ADHD workspace integration** using the project overview and Telegram research. This feature is only for the owner-controlled workspace; do not add discovery, outreach, unsolicited messaging, member scraping, or public posting behavior.

D1 remains canonical. Use a controller integration for human input and configured persona identities for agent output. Keep Telegram-specific transport behind an adapter. Preserve internal/Telegram message mappings, replies, thread association, duplicate-update protection, message-length handling, and controlled retries.

Normal human discussion in the configured workspace should flow into one coarse interactive agent job. Agent output should map back to the originating internal thread. Do not depend on Telegram bot-to-bot delivery for internal orchestration.

Automated tests must use fakes rather than contacting Telegram.

## Acceptance

A test human message creates one internal message/job; replay is idempotent; a configured agent response maps to one Telegram message record; a test reply maps back to the right internal thread/agent.