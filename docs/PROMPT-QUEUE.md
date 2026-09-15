# Prompt Queue

This is the operator-visible backlog for work that is intentionally deferred. It is not the
runtime state of the `@0xsero/open-queue` plugin: `/queue hold`, `/queue immediate`, and
`/queue status` control that plugin directly.

Keep each entry to one actionable request, a priority, and the reason it is deferred. The
orchestrator consults this file only when the operator explicitly asks to review or work the
queue; it must not load it for ordinary focused work.

## Pending

_No queued operator requests._
