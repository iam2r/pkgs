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

## Two layers

Neither mechanism covers every request path on its own, so both are installed.

1. **`before_provider_headers`** — the official event. Emitted only from the
   coding-agent SDK's request-options builder, which covers the main agent loop but
   **not** callers that invoke `ctx.modelRegistry.streamSimple(...)` directly.
   Extensions do that for side requests (pi-subagents' pruned-fork summaries, for
   example), and those would reach the gateway with no session header.

2. **A registered provider wrapper** — `pi.registerProvider(<provider>, { api,
   streamSimple })` whose `streamSimple` injects and then delegates to the real API
   implementation via `getApiProvider`. This sits at the model-registry layer, so
   **every** caller is covered, including direct `streamSimple` calls.

The wrapper is additive: registering a provider that declares no `models` array
leaves your existing `baseUrl`, `apiKey` and model list untouched. It is registered
only when the provider already exists (and is wrapped in a guard), so this extension
is inert on machines that don't configure one.

## Configuration

All optional, via environment variables.

| Variable                    | Default              | Meaning                                                                                                                                          |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PI_OPENCODE_PROVIDER`      | `Agate`              | Provider id(s) to wrap, comma separated.                                                                                                         |
| `PI_OPENCODE_API`           | `openai-completions` | The api id the wrapper handles. A provider config can only declare one `api`; models using another api still get layer 1 on the main-agent path. |
| `PI_OPENCODE_SESSION_STYLE` | `raw`                | `raw` forwards Pi's session id verbatim. `canonical` derives a `ses_…` id instead.                                                               |
| `PI_OPENCODE_NO_PROVIDER`   | _(unset)_            | Set to `1` to disable layer 2 and use the event hook alone.                                                                                      |
| `PI_OPENCODE_HDR_DEBUG`     | _(unset)_            | File path; appends one JSON line per injection.                                                                                                  |

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

Each injected request appends a line naming the layer, the model and the header
values actually sent. No request is modified unless a line appears.

## License

MIT
