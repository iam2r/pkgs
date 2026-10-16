---
'@iam2r/pi-opencode-session-header': patch
---

Read the session id lazily, with the live session and the session file as fallbacks.

Layer 2 sends whatever session id the extension last cached, and that cache was filled
only by `session_start` and by the first main-agent request. Both can come too late:
Pi awaits event handlers in load order, so one slow handler delays every handler after
it, and a side request can arrive while the id is still unknown. Measured with a slow
handler ahead of ours, the first `ctx.modelRegistry.streamSimple(...)` call reached the
api wrapper with no session id and went out without the header.

The id now resolves on demand: the cached value when there is one, then the live
session, then the session file name (`<timestamp>_<id>.jsonl`), and a context captured
before a reload counts as no answer instead of throwing. Extracted to
`session-source.ts` with unit tests.

Also corrects the README: Pi clears api overrides on `AgentSession.reload()` via
`resetApiProviders()`, which is what the per-session re-assert guards against.
