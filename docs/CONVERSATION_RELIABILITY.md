# Conversation reliability

LUMA ADHD treats human discussion and autonomous work as different execution
modes.

## Human messages

Plain-language Agent names are direct addresses. For example, `رادین` and
`Radin` route the first turn to `agent-product`, while an explicit Telegram
reply remains the strongest routing signal. Names are normalized without
requiring an `@username`.

Structured-output failures use one application repair attempt. The repair has a
larger bounded output allowance than the initial action so a complete JSON
action is not truncated. It does not create an unbounded retry loop.

## Autonomous work

Ambient opportunities are private by default. Agents may still inspect context,
update files or memory, request another Agent, request human input, or WAIT.
An ambient `SPEAK` action is projected only when it follows recent substantive
human work in the same thread. A stale or inactive-thread `SPEAK` is recorded as
an executed opportunity and converted to `WAIT`; it is never published as an
unprompted strategic opening.

This keeps autonomous work useful without turning quiet threads into Telegram
noise. The runtime records the suppression reason in an internal event and turn
metadata, without storing message bodies or secrets in the diagnostic event.
