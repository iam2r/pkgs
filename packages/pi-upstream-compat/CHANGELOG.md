# @iam2r/pi-upstream-compat

## 0.6.1

### Patch Changes

- 534bf94: Scope registry decoration to the provider a session is actually using.

  0.6.0 marked every matching model in the registry, and the registry also holds each
  built-in provider's whole catalog: on a fresh install that meant hundreds of models
  (OpenRouter's `deepseek/*`, `minimax/*`, …) were redesignated as reasoning models purely
  because of their id. Decoration now takes the session's provider
  (`ctx.model?.provider`) at `session_start`, on `model_select`, and on the header event,
  so gateway models get the flag and built-in catalogs stay exactly as Pi shipped them.

## 0.6.0

### Minor Changes

- 59ad8f1: Mark thinking-mode models in the session's model registry, so the UI agrees with the
  request builder.

  Until now the compat was only applied to the model object on its way into the request,
  which is enough for `reasoning_content` but leaves the catalog and the thinking-level
  controls reporting `thinking: no`. Pi reads capabilities from the registry
  (`AgentSession.supportsThinking()` checks `model.reasoning`), so the models are now
  decorated at `session_start`, on `model_select`, and on the main-agent header event.

  - `decorateRegistryModels()` marks every matching model in place and counts the ones
    that changed; a registry that throws is ignored rather than breaking the session.
  - Repeated session starts and model switches are idempotent.
  - An explicit `reasoning: false` still wins, and frozen models are copied.
  - The debug log gains a `registry` line with the number of models marked.

  `pi --list-models` still prints `thinking: no`: it lists the catalog without a session,
  and Pi exposes no model-registry handle at extension-load time.

## 0.5.0

### Minor Changes

- f721d33: Rename the package from `@iam2r/pi-opencode-session-header`, and take on the
  thinking-mode replay fix it was already adjacent to.

  The package is no longer only about session headers, so the name now says what it
  does: upstream compatibility shims decided by model id.

  - New: models whose id contains a thinking family fragment (`deepseek`, `kimi`,
    `glm`, `minimax`, `mimo`) are marked `reasoning: true` with
    `compat.requiresReasoningContentOnAssistantMessages`, so Pi replays
    `reasoning_content` on assistant turns. DeepSeek-family gateways answer
    ``400 The `reasoning_content` in the thinking mode must be passed back to the API``
    without it, and Pi's own detection is URL-based, never id-based.
    - `PI_UPSTREAM_COMPAT_THINKING_MATCH` appends extra fragments.
    - `PI_UPSTREAM_COMPAT_NO_THINKING=1` leaves model metadata untouched.
    - an explicit `reasoning: false` in `models.json` wins, and frozen models are
      copied rather than mutated.
  - Environment variables are renamed `PI_OPENCODE_*` → `PI_UPSTREAM_COMPAT_*`; the old
    names are still read as fallbacks. `PI_UPSTREAM_COMPAT_DEBUG` replaces
    `PI_OPENCODE_HDR_DEBUG`.
  - Debug lines now carry a `thinking` field, so an injected request says whether the
    compat applies to its model.

## 0.3.3

### Patch Changes

- 9f5ec1a: Correct the documented reason layer 2 is re-asserted, and record what was measured.

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

## 0.3.2

### Patch Changes

- cd3fc7c: Resolve the layer-2 session id on demand, and correct the README.

  The wrapper now reads the id instead of only trusting a snapshot: the cached value,
  then the live session, then the session file name (`<timestamp>_<id>.jsonl`). A
  context captured before a reload counts as no answer instead of throwing. Extracted
  to `session-source.ts` with unit tests.

  This is hardening, not a fix for a reproduced failure: at this extension's
  `session_start` the id is already there (measured), so the cache is normally
  populated first. It matters when that is not the case, since Pi awaits event handlers
  in load order and one slow handler delays every handler after it.

  The README no longer claims the wrapper is wiped by Pi's bootstrap; it names the
  `resetApiProviders()` reload path, and records the boundary that a side request
  arriving before any handler of this extension has run cannot carry a session id.

## 0.3.1

### Patch Changes

- a8b3aa1: Re-assert the api-layer wrapper on every `session_start`.

  `AgentSession.reload()` (`core/agent-session.js`), which serves `/reload` and session
  replacement, calls `resetApiProviders()`: every api registration is dropped and only
  the built-ins are put back. The wrapper is now installed while the factory runs _and_
  re-asserted on each `session_start`, so it is present again after such a reload.

  Re-installing is idempotent. The host registry keeps one entry per api and does not
  say who owns it, so `unregisterApiProviders(<our source>)` doubles as the probe:
  removing our own entry empties the slot while we still own it, and leaves the host's
  implementation visible when we no longer do — that implementation is then adopted as
  the new base. Wrappers always delegate to a captured base, never to the registry, so
  repeated installs cannot stack.

  `PI_OPENCODE_HDR_DEBUG` now distinguishes `api-installed` (fresh wrapper, or a new
  base) from `api-reinstalled` (re-asserted unchanged).

  Correction: this entry originally described the wrapper as wiped by Pi's bootstrap
  after extension loading. That came from a probe that slept inside a `session_start`
  handler, which delayed this extension's own handler and left the session id unknown,
  so the header was missing for a different reason. The registry entry was in fact
  still ours; the reload path above is the real reason to re-assert.

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
