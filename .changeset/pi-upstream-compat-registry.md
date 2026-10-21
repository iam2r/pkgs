---
'@iam2r/pi-upstream-compat': minor
---

Mark thinking-mode models in the session's model registry, so the UI agrees with the
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
