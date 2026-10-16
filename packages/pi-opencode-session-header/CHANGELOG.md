# @iam2r/pi-opencode-session-header

## 0.1.0

### Minor Changes

- Initial release. Attaches OpenCode's session-affinity headers
  (`x-opencode-session`, plus `x-opencode-client: pi`) to any model whose id
  mentions `opencode`, including models served through third-party gateways
  that Pi would not otherwise treat as OpenCode.

  Two layers cooperate: a `before_provider_headers` hook covers the main agent,
  and a registered `streamSimple` wrapper covers every other caller such as
  subagent pruned forks. A header that is already present is never overwritten.
