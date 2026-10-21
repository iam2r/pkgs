---
'@iam2r/pi-upstream-compat': minor
---

Rename the package from `@iam2r/pi-opencode-session-header`, and take on the
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
