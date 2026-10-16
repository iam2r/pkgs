---
'@iam2r/pi-opencode-session-header': patch
---

Spell out in the README that `PI_OPENCODE_PROVIDER` defaults to `Agate`.

On any other machine it has to be set to your own provider id, or layer 2 is
never registered and only the event hook applies — enough for the main agent,
but not for direct `streamSimple` side requests.
