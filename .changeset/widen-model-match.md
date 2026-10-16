---
'@iam2r/pi-opencode-session-header': minor
---

Add `PI_OPENCODE_MODEL_MATCH`, for gateways that rename their OpenCode models.

Matching keyed off the model id containing `opencode`, so a gateway that serves an
upstream OpenCode model under a name of its own — `deepseek-v4.1-flash-free`, say —
received no session header at all, and failed silently. `PI_OPENCODE_MODEL_MATCH`
takes a comma-separated list of extra substrings to treat as OpenCode too; the
built-in `opencode` match is kept and matching stays case-insensitive.
