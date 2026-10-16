#!/usr/bin/env node
// lint-staged shim for oxlint: skip files excluded by .oxlintrc.json
// ignorePatterns (oxlint exits 1 with "No files found to lint" when the
// whole staged set is ignored, which lint-staged treats as a failure).
//
// Usage (package.json lint-staged config):
//   "*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}": "node scripts/lint-staged-oxlint.mjs"
//
// lint-staged appends staged file paths; we filter out ignorePatterns,
// then hand the remainder to `oxlint --type-aware --fix`.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2).map((f) => {
	// lint-staged passes absolute paths; normalize to repo-relative for matching
	const cwd = process.cwd().replace(/[\\/]+$/, '');
	const abs = f.replace(/[\\/]+/g, '/');
	const rel = abs.startsWith(cwd + '/') ? abs.slice(cwd.length + 1) : abs;
	return rel;
});
if (files.length === 0) process.exit(0);

// Resolve .oxlintrc.json relative to the repo root (cwd of lint-staged).
let configPath = '.oxlintrc.json';
if (!exists(configPath)) configPath = '.oxlintrc.jsonc';
if (!exists(configPath)) {
	console.error('lint-staged-oxlint: no .oxlintrc.json(c) found');
	process.exit(1);
}

const raw = readFileSync(configPath, 'utf-8')
	.replace(/\/\/.*$/gm, '')
	.replace(/,\s*([}\]])/g, '$1')
	.trim();
let config;
try {
	config = JSON.parse(raw);
} catch (e) {
	console.error('lint-staged-oxlint: failed to parse', configPath, e.message);
	process.exit(1);
}

const patterns = config.ignorePatterns ?? [];

function matchAny(path, patterns) {
	for (const pat of patterns) {
		// Convert simple glob to regex. Patterns like "workers/**/worker/main.js"
		// or "**/dist" are relative to repo root.
		const norm = pat.replace(/\\/g, '/');
		const re = new RegExp(
			'^' +
				norm
					.replace(/[.+^${}()|[\]\\]/g, '\\$&')
					.replace(/\*\*/g, '.*')
					.replace(/\*/g, '[^/]*')
					.replace(/\?/g, '[^/]') +
				'$',
		);
		if (re.test(path) || re.test(path.replace(/^\.\//, ''))) return true;
	}
	return false;
}

const lintable = files.filter((f) => !matchAny(f, patterns));

if (lintable.length === 0) {
	process.exit(0); // everything was ignored by oxlint config
}

const cp = spawn('npx', ['oxlint', '--type-aware', '--fix', ...lintable], {
	stdio: 'inherit',
});
cp.on('close', (code) => process.exit(code ?? 1));

function exists(p) {
	try {
		readFileSync(p, 'utf-8');
		return true;
	} catch {
		return false;
	}
}
