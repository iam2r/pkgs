# @iam2r/pi-upstream-compat

A [Pi](https://github.com/earendil-works/pi) extension that fixes **two upstream
quirks Pi only handles for its own built-in providers** — both decided by model id,
so they work for any model served through a third-party gateway:

1. **OpenCode session affinity** — attach `x-opencode-session` / `x-opencode-client`
   to models whose id mentions `opencode`.
2. **Thinking-mode replay** — mark DeepSeek-family thinking models so Pi replays
   `reasoning_content` on assistant turns, which upstream requires.

## The problems

### 1. OpenCode session headers

Pi only sends OpenCode's session headers when the selected model is served by its
own built-in `opencode` / `opencode-go` providers, or when the request URL host is
exactly `opencode.ai`
([`getSessionHeaders()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/provider-attribution.ts)).

Model ids also travel through third-party OpenAI-compatible gateways — for example
`builtin:opencode/deepseek-v4.1-flash-free` served by a custom provider. Pi sees the
gateway as the `provider`, so the gate can never match and **no session header is
sent at all**. Upstream then either

- rejects the request outright — `400 MissingSessionID` — or
- accepts it but derives a fresh session per request, destroying prompt-cache affinity
  (every turn pays full input-cache cost and latency).

### 2. Thinking-mode `reasoning_content`

DeepSeek-family thinking upstreams reject a replayed assistant turn that carries
`tool_calls` but no `reasoning_content`:

```
400 The `reasoning_content` in the thinking mode must be passed back to the API.
```

Pi already knows how to satisfy that: a model with
`compat.requiresReasoningContentOnAssistantMessages` gets `reasoning_content: ""`
replayed on assistant messages. Pi sets that flag on its built-in `opencode-go` and
`deepseek` models, and its other detection is URL-based (`opencode.ai`,
`api.deepseek.com`) — never id-based. A model declared with a custom provider and a
gateway base URL therefore never gets the flag, and every tool-using turn fails.

## Install

```sh
pi install npm:@iam2r/pi-upstream-compat
```

For a single run without installing:

```sh
pi -e npm:@iam2r/pi-upstream-compat
```

Then restart Pi — extensions load at startup.

> **Renamed.** This package was published as `@iam2r/pi-opencode-session-header`
> up to 0.3.3. Replace it with the name above; the old `PI_OPENCODE_*` environment
> variables keep working, but `PI_UPSTREAM_COMPAT_*` is the documented spelling now.

## What it matches

### Session headers

A request gets the session header when **any** of these hold:

| Condition                                           | Example                                     |
| --------------------------------------------------- | ------------------------------------------- |
| provider is `opencode` or `opencode-go`             | Pi's built-in providers                     |
| baseUrl host is exactly `opencode.ai`               | `https://opencode.ai/inference/go/v1`       |
| **model id contains `opencode`** (case-insensitive) | `builtin:opencode/deepseek-v4.1-flash-free` |

It appends `x-opencode-session` (the session id, see below) plus
`x-opencode-client: pi`, and never overwrites a header another layer already set.

The id rule is the one that breaks in practice, because a gateway need not keep the
upstream model name: `deepseek-v4.1-flash-free`, with no `opencode` anywhere in it,
matches nothing above. Set `PI_UPSTREAM_COMPAT_MODEL_MATCH` to a comma-separated
list of extra substrings (for example `deepseek,v4.1`) and those ids are recognised
too.

### Thinking-mode compat

An assistant turn is replayed with `reasoning_content` when the **model id** contains
one of these fragments (case-insensitive):

| Default fragments                            | Family                                         |
| -------------------------------------------- | ---------------------------------------------- |
| `deepseek`, `kimi`, `glm`, `minimax`, `mimo` | thinking upstreams that require the field back |

Add more with `PI_UPSTREAM_COMPAT_THINKING_MATCH` (comma separated, **appended** to
the defaults — setting one extra family cannot silently switch DeepSeek off).
`PI_UPSTREAM_COMPAT_NO_THINKING=1` disables this half of the extension entirely.

What the extension does for a matching model, right before Pi serializes the request:

- sets `model.reasoning = true` (unlocks Pi's thinking levels and is the gate Pi uses
  for the replay), unless the model already says `reasoning: true`
- sets `compat.requiresReasoningContentOnAssistantMessages = true`, merging into an
  existing `compat` object and keeping its other flags
- **never** overrides an explicit `reasoning: false` — use that in `models.json` to
  opt one model out
- never mutates a frozen model: it hands the implementation a shallow copy instead

The decision is per request, so it also covers models added to `models.json` after Pi
started, and models whose ids a gateway rewrites.

> Marking a model as reasoning is not free — Pi offers thinking levels for it and may
> send reasoning parameters. The defaults stay narrow on purpose. If you add a family
> that is not actually a thinking model, expect upstream errors; remove it from
> `PI_UPSTREAM_COMPAT_THINKING_MATCH` or set `reasoning: false` for that model.

## Two layers

Neither mechanism covers every request path on its own, so both are installed.

1. **`before_provider_headers`** — the official event. Emitted only from the
   coding-agent SDK's request-options builder, which covers the main agent loop but
   **not** callers that invoke `ctx.modelRegistry.streamSimple(...)` directly.
   Extensions do that for side requests (pi-subagents' pruned-fork summaries, for
   example), and those would reach the gateway with no session header.

2. **An api-level wrapper** — `registerApiProvider()` around the api implementation
   named by `PI_UPSTREAM_COMPAT_API` (default `openai-completions`). It injects for
   matching models, applies thinking compat, and delegates to the implementation it
   captured, so it sits **below** every caller and needs no knowledge of which
   provider serves the model.

Both layers are idempotent with each other: whichever sees the request first sets the
headers or model flag, and the second one finds nothing left to do.

### Why layer 2 is re-asserted on every session

Two host behaviours shape this layer.

First, it cannot be a named provider registration:

```js
// pi-coding-agent/dist/core/extensions/loader.js
registerProvider: (name, config, extensionPath) => {
	runtime.pendingProviderRegistrations.push({ name, config, extensionPath });
};
```

The host drains `pendingProviderRegistrations` once, at extension-load time
(`extensions/runner.js:bindCore()`). A `pi.registerProvider(...)` call made _after_
that — from a `session_start` handler, say — only appends to a queue nobody reads
again, so it is silently dropped, even though the call returns normally. Wrapping the
api implementation sidesteps that queue, needs no provider id, and covers every
provider serving that api at once.

Second, Pi clears api overrides when a session reloads: `AgentSession.reload()`
(`core/agent-session.js`), which serves `/reload` and session replacement, calls
`resetApiProviders()` — every registration is dropped and only the built-ins are put
back. So the wrapper is installed while the factory runs **and** re-asserted on every
`session_start`. Re-installing is idempotent: the previous entry is dropped first, and
the wrapper delegates to a captured base instead of to the registry, so installs
cannot stack.

### Why the session id is read lazily

The api wrapper runs outside any event context, so it needs a session id of its own.
The cache is filled on `session_start` and refreshed on every `before_provider_headers`,
and requests read the live session whenever that cache is empty — the session file
name (`<timestamp>_<id>.jsonl`) is the last resort. A context captured before a reload
counts as no answer instead of throwing.

This is hardening rather than a fix for a reproduced failure: at this extension's
`session_start` the id is already available (measured), so the cache is normally
populated before anything can ask. The fallback matters when it is not — an earlier
handler that yields for a while delays every handler after it, since Pi awaits them in
load order, and a session can be asked for a request while it starts.

The remaining boundary is inherent: a side request that arrives before any handler of
this extension has run cannot be helped. The request carries no session information of
its own, and Pi exposes no session id outside an event context (`ExtensionAPI` has no
session getter). Requests after the first handler are covered.

## Configuration

All optional, via environment variables. The pre-rename `PI_OPENCODE_*` names are
still read as fallbacks.

| Variable                            | Default              | Meaning                                                                                                        |
| ----------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PI_UPSTREAM_COMPAT_API`            | `openai-completions` | Api id(s) layer 2 wraps, comma separated. Every provider serving a model with one of these api ids is covered. |
| `PI_UPSTREAM_COMPAT_SESSION_STYLE`  | `raw`                | `raw` forwards Pi's session id verbatim. `canonical` derives a `ses_…` id instead.                             |
| `PI_UPSTREAM_COMPAT_MODEL_MATCH`    | _(unset)_            | Extra model-id substrings (comma separated) that also count as OpenCode, for gateways that rename them.        |
| `PI_UPSTREAM_COMPAT_NO_PROVIDER`    | _(unset)_            | Set to `1` to disable layer 2 and use the event hook alone.                                                    |
| `PI_UPSTREAM_COMPAT_THINKING_MATCH` | _(unset)_            | Extra model-id fragments that get the thinking-mode compat flag, appended to the defaults.                     |
| `PI_UPSTREAM_COMPAT_NO_THINKING`    | _(unset)_            | Set to `1` to leave model metadata untouched.                                                                  |
| `PI_UPSTREAM_COMPAT_DEBUG`          | _(unset)_            | File path; appends one JSON line per injection, plus one per layer-2 install.                                  |

Set `PI_UPSTREAM_COMPAT_API` if your gateway speaks a different api (for example
`anthropic-messages` or `openai-responses`). Unlike the event hook, layer 2 sees only
the api ids it is told about.

### `raw` vs `canonical`

- `raw` sends Pi's own session id (`01a144cf-8eeb-72cd-aec1-3ee2789673ef`). Correct
  when the gateway forwards the header unchanged to the upstream OpenCode
  deployment.
- `canonical` derives `ses_…` in the same descending-timestamp + base62 layout
  OpenCode uses, so a gateway that validates the **shape** of the header also
  accepts it. The derivation is deterministic — a stable Pi session always produces
  the same id — and idempotent, so an already-canonical value passes through.

Pick `canonical` if upstream rejects a raw id for being malformed; pick `raw` if
upstream only requires a stable opaque key.

## Verify

```sh
PI_UPSTREAM_COMPAT_DEBUG=/tmp/oc-headers.log pi -e npm:@iam2r/pi-upstream-compat
```

Each injected request appends a line naming the layer (`event` or `api`), the model,
whether the thinking-mode compat applies to it, and the header values actually sent.
Other lines report the layer-2 install: `api-installed` (fresh wrapper, or a new base
after the host replaced ours), `api-reinstalled` (re-asserted unchanged on
`session_start`), `api-missing`, `api-incomplete`, `api-failed`.

A request is only ever modified when an injection line appears for it. Thinking-mode
compat has no line of its own: check the `thinking` field of a request's line, then the
`compat` flag on that model.

## License

MIT
