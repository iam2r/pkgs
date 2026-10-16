---
'@iam2r/pi-opencode-session-header': patch
---

Re-assert the api-layer wrapper on every `session_start`, so layer 2 survives Pi's
own bootstrap.

0.3.0 installed the wrapper while the extension factory ran, but Pi's bootstrap runs
_after_ the extension factories and replaces the api-registry entry written there.
By the time a session started, the wrapper was gone again: the extension logged
`api-installed`, and a direct `ctx.modelRegistry.streamSimple(...)` call — the path
layer 2 exists for — still reached the api with no session header.

The wrapper is now installed at factory time _and_ on every `session_start`. Since
the host registry keeps one entry per api and does not say who owns it,
`unregisterApiProviders(<our source>)` doubles as the probe: removing our own entry
empties the slot while we still own it, and leaves the host's implementation visible
when we no longer do — that implementation is then adopted as the new base. Wrappers
always delegate to a captured base, never to the registry, so repeated installs
cannot stack.

`PI_OPENCODE_HDR_DEBUG` now distinguishes `api-installed` (fresh wrapper, or a new
base) from `api-reinstalled` (re-asserted unchanged).
