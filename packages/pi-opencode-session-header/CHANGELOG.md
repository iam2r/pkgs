# @iam2r/pi-opencode-session-header

## 0.3.0

### Minor Changes

- d81f756: Layer 2 now actually runs: it wraps the api implementation at extension-load time
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

## 0.2.1

### Patch Changes

- 04a9b48: Spell out in the README that `PI_OPENCODE_PROVIDER` defaults to `Agate`.

  On any other machine it has to be set to your own provider id, or layer 2 is
  never registered and only the event hook applies — enough for the main agent,
  but not for direct `streamSimple` side requests.

## 0.2.0

### Minor Changes

- 1d0082f: Add `PI_OPENCODE_MODEL_MATCH`, for gateways that rename their OpenCode models.

  Matching keyed off the model id containing `opencode`, so a gateway that serves an
  upstream OpenCode model under a name of its own — `deepseek-v4.1-flash-free`, say —
  received no session header at all, and failed silently. `PI_OPENCODE_MODEL_MATCH`
  takes a comma-separated list of extra substrings to treat as OpenCode too; the
  built-in `opencode` match is kept and matching stays case-insensitive.

## 0.1.0

### Minor Changes

- Initial release. Attaches OpenCode's session-affinity headers
  (`x-opencode-session`, plus `x-opencode-client: pi`) to any model whose id
  mentions `opencode`, including models served through third-party gateways
  that Pi would not otherwise treat as OpenCode.

  Two layers cooperate: a `before_provider_headers` hook covers the main agent,
  and a registered `streamSimple` wrapper covers every other caller such as
  subagent pruned forks. A header that is already present is never overwritten.
