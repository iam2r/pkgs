---
'@iam2r/pi-opencode-session-header': patch
---

Correct the documented reason layer 2 is re-asserted, and record what was measured.

0.3.1's changelog said Pi's bootstrap replaces the api-registry entry written while
extensions load. That came from a probe that slept inside a `session_start` handler:
Pi awaits handlers in load order, so the sleep delayed this extension's own handler and
left the session id unknown — the header was missing for that reason, and the registry
entry was in fact still ours. The real reason to re-assert is `AgentSession.reload()`,
which serves `/reload` and session replacement and calls `resetApiProviders()`, dropping
every api override.

The README now also states the boundary rather than implying full coverage: a side
request that arrives before any handler of this extension has run cannot carry a session
id, because the request has no session information of its own and `ExtensionAPI` exposes
no session getter outside an event context. Requests after the first handler are
covered, including the `ctx.modelRegistry.streamSimple(...)` path layer 2 exists for.
