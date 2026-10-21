---
'@iam2r/pi-upstream-compat': patch
---

Make the thinking-mode compat actually apply to `models.json` providers.

Pi's provider composer fills `reasoning: false` for every model declared in
`models.json` without an explicit value (`provider-composer.js`:
`definition.reasoning ?? false`), so the previous "an explicit `reasoning: false` wins"
rule matched the _normal_ state of exactly the gateway models this extension exists for:
nothing was ever marked, and `reasoning_content` was never replayed.

- matching now applies regardless of the defaulted `reasoning: false`; opt out with the
  new `PI_UPSTREAM_COMPAT_THINKING_EXCLUDE` (id fragments) or `..._NO_THINKING=1`
- models that Pi's own catalog defines are left alone (`getBuiltinModel`), so a
  non-thinking `deepseek-chat` is not redesigned as a reasoning model
- decoration also runs at `before_agent_start`, where the catalog and the session model
  are guaranteed to be ready
- the debug log's `registry` line reports the provider and the number of models marked
