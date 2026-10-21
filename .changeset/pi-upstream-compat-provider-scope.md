---
'@iam2r/pi-upstream-compat': patch
---

Scope registry decoration to the provider a session is actually using.

0.6.0 marked every matching model in the registry, and the registry also holds each
built-in provider's whole catalog: on a fresh install that meant hundreds of models
(OpenRouter's `deepseek/*`, `minimax/*`, …) were redesignated as reasoning models purely
because of their id. Decoration now takes the session's provider
(`ctx.model?.provider`) at `session_start`, on `model_select`, and on the header event,
so gateway models get the flag and built-in catalogs stay exactly as Pi shipped them.
