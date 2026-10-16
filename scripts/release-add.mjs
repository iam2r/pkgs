#!/usr/bin/env node
/**
 * release:add — changeset generator.
 *
 * Records a .changeset/*.md change intent for a package so the release flow
 * (packages-all-version → Version Packages PR → packages-all-release) can
 * advance versions. Wraps `pnpm change` / `pnpm changeset`.
 *
 *   pnpm release:add                       # interactive (package, bump, summary)
 *   pnpm release:add @iam2r/core-logger --bump patch --summary "fix x"  # one-shot
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);

// Interactive: delegate to changeset's own flow (package + bump + summary).
// One-shot: forward to `pnpm change <pkg> --bump <level> --summary <text>`.
execFileSync('pnpm', args.length === 0 ? ['changeset'] : ['change', ...args], { stdio: 'inherit' });
