# pkgs

Small, focused packages. Published to the public npm registry under the
[`@iam2r`](https://www.npmjs.com/org/iam2r) scope.

| Package                                                                    | Description                                                                                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@iam2r/pi-opencode-session-header`](packages/pi-opencode-session-header) | Pi extension: attach OpenCode session-affinity headers to any model whose id mentions `opencode`, including models behind third-party gateways. |

## Layout

```
packages/<name>/     one publishable package; directory name is the scope-relative package name
scripts/             repo automation (release helper, lint-staged adapter, clean)
.changeset/          release intent — every packages/** change needs one
.github/workflows/   single changesets/action workflow
```

Packages ship TypeScript sources directly and are consumed by a runtime that
transpiles them, so there is no bundle step: each package's `build` script is a
type check.

## Requirements

- Node ≥ 24, pnpm ≥ 10

```sh
pnpm install
```

## Commands

| Command                       | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `pnpm build:pkg`              | Type check every package (turbo).                                      |
| `pnpm test`                   | Run every package's tests (turbo).                                     |
| `pnpm clean:pkg`              | Remove `packages/*/dist`.                                              |
| `pnpm release:add`            | Interactive changeset generator — the normal way to request a release. |
| `pnpm release:version`        | Apply changesets: bump versions + changelogs.                          |
| `pnpm release:full`           | Type check, tag, then publish every bumped package. Used by CI.        |
| `pnpm fmt` / `pnpm fmt:check` | Format with oxfmt.                                                     |
| `pnpm lint`                   | oxlint, type-aware, with `--fix`.                                      |

Commits are checked by husky: `pre-commit` runs lint-staged (oxlint + oxfmt) and
`commit-msg` enforces [Conventional Commits](https://www.conventionalcommits.org/).

## Release flow

Fully automated through changesets — no manual version bumps, no manual publish.

1. Change a package and run `pnpm release:add`, committing the generated
   `.changeset/*.md` with the change. CI rejects a PR touching `packages/**`
   without a changeset.
2. On merge to `main`, `.github/workflows/packages-release.yml` consumes the
   changesets and opens (or updates) a **Version Packages** PR.
3. CI auto-merges that PR. The resulting push has no changesets left, so the same
   workflow builds, tags and publishes every bumped package to npm, then creates a
   GitHub Release.

Add a package with `npm publish` rights for `@iam2r` as the repo secret
`NPM_TOKEN`, and enable _Settings → Actions → General → Workflow permissions →
Allow GitHub Actions to create and approve pull requests_.

## License

MIT
