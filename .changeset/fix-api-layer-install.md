---
'@iam2r/pi-opencode-session-header': minor
---

Layer 2 now actually runs: it wraps the api implementation at extension-load time
instead of registering a provider from a `session_start` handler.

The provider registration was silently dropped. After extension loading,
`pi.registerProvider(...)` only appends to `runtime.pendingProviderRegistrations`,
and the host drains that queue once, while extensions load — so the call returned
normally and layer 2 was never installed. Requests that bypass the
`before_provider_headers` event (any `ctx.modelRegistry.streamSimple(...)` caller,
such as pi-subagents' pruned-fork summaries) went out with no session header at all.

Layer 2 is now `registerApiProvider()` around the `PI_OPENCODE_API` implementation,
installed while the factory runs. It covers every caller and every provider serving
that api — no provider id needed.

Because of that:

- `PI_OPENCODE_PROVIDER` is gone; layer 2 no longer targets a provider by name.
- `PI_OPENCODE_API` is now a comma-separated list of api ids to wrap.
- `PI_OPENCODE_NO_PROVIDER=1` still disables layer 2.
- `PI_OPENCODE_HDR_DEBUG` logs `api-installed`/`api-missing` and reports injections
  from layer 2 with `layer: "api"` (`event` for layer 1, as before).

Verified with a gateway configured as a plain `openai-completions` provider: the
main agent loop injects via the event layer, and a direct `streamSimple` call with
no prior event injects via the api layer.
