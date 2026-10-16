# @iam2r/pi-opencode-session-header

A [Pi](https://github.com/earendil-works/pi) extension that attaches OpenCode's
session-affinity headers to **any model whose id mentions `opencode`** — including
models routed through a third-party gateway.

## The problem

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

This extension re-applies the same logic whenever the model id contains `opencode`,
so gateways get the header Pi would have sent.

## Install

```sh
pi install npm:@iam2r/pi-opencode-session-header
```

For a single run without installing:

```sh
pi -e npm:@iam2r/pi-opencode-session-header
```

Then restart Pi — extensions load at startup.

## What it matches

A request gets the header when **any** of these hold:

| Condition                                           | Example                                     |
| --------------------------------------------------- | ------------------------------------------- |
| provider is `opencode` or `opencode-go`             | Pi's built-in providers                     |
| baseUrl host is exactly `opencode.ai`               | `https://opencode.ai/inference/go/v1`       |
| **model id contains `opencode`** (case-insensitive) | `builtin:opencode/deepseek-v4.1-flash-free` |

It appends `x-opencode-session` (the session id, see below) plus
`x-opencode-client: pi`, and never overwrites a header another layer already set.

The id rule is the one that breaks in practice, because a gateway need not keep the
upstream model name: `deepseek-v4.1-flash-free`, with no `opencode` anywhere in it,
matches nothing above. Set `PI_OPENCODE_MODEL_MATCH` to a comma-separated list of
extra substrings (for example `deepseek,v4.1`) and those ids are recognised too.

## Two layers

Neither mechanism covers every request path on its own, so both are installed.

1. **`before_provider_headers`** — the official event. Emitted only from the
   coding-agent SDK's request-options builder, which covers the main agent loop but
   **not** callers that invoke `ctx.modelRegistry.streamSimple(...)` directly.
   Extensions do that for side requests (pi-subagents' pruned-fork summaries, for
   example), and those would reach the gateway with no session header.

2. **An api-level wrapper** — `registerApiProvider()` around the api implementation
   named by `PI_OPENCODE_API` (default `openai-completions`). It injects for matching
   models and delegates to the implementation it captured, so it sits **below** every
   caller and needs no knowledge of which provider serves the model.

Both layers are idempotent with each other: whichever sees the request first sets the
headers, and the second one finds nothing left to add.

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
Caching it at `session_start` is not enough: Pi awaits handlers in load order, so a
handler that takes time delays every handler after it, and a side request can arrive
while the id is still unknown — measured with a slow handler ahead of ours, the first
`ctx.modelRegistry.streamSimple(...)` call went out with no header. The cache is
refreshed on `session_start` and on every `before_provider_headers`, with the live
session and the session file name (`<timestamp>_<id>.jsonl`) as fallbacks.

## Configuration

All optional, via environment variables.

| Variable                    | Default              | Meaning                                                                                                        |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PI_OPENCODE_API`           | `openai-completions` | Api id(s) layer 2 wraps, comma separated. Every provider serving a model with one of these api ids is covered. |
| `PI_OPENCODE_SESSION_STYLE` | `raw`                | `raw` forwards Pi's session id verbatim. `canonical` derives a `ses_…` id instead.                             |
| `PI_OPENCODE_MODEL_MATCH`   | _(unset)_            | Extra model-id substrings (comma separated) that also count as OpenCode, for gateways that rename them.        |
| `PI_OPENCODE_NO_PROVIDER`   | _(unset)_            | Set to `1` to disable layer 2 and use the event hook alone.                                                    |
| `PI_OPENCODE_HDR_DEBUG`     | _(unset)_            | File path; appends one JSON line per injection, plus one per layer-2 install.                                  |

Set `PI_OPENCODE_API` if your gateway speaks a different api (for example
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
PI_OPENCODE_HDR_DEBUG=/tmp/oc-headers.log pi -e npm:@iam2r/pi-opencode-session-header
```

Each injected request appends a line naming the layer (`event` or `api`), the model
and the header values actually sent. Other lines report the layer-2 install:
`api-installed` (fresh wrapper, or a new base after the host replaced ours),
`api-reinstalled` (re-asserted unchanged on `session_start`), `api-missing`,
`api-incomplete`, `api-failed`.

A request is only ever modified when an injection line appears for it.

## License

MIT
