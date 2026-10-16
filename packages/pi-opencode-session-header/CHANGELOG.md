# @iam2r/pi-opencode-session-header

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
