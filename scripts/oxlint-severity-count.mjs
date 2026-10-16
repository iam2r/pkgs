#!/usr/bin/env node
/**
 * oxlint-severity-count — run oxlint and count diagnostics by severity/rule.
 *
 * Usage:
 *   node scripts/oxlint-severity-count.mjs                # respects .oxlintrc.json
 *   node scripts/oxlint-severity-count.mjs --unfiltered   # strips allow/off from rules
 *   npx oxlint --type-aware -f=json | node scripts/oxlint-severity-count.mjs
 *
 * `--unfiltered` reads .oxlintrc.json, removes all rules set to "allow" or "off",
 * then runs oxlint with that modified config.  Everything else (categories,
 * plugins, ignorePatterns, env) stays intact — you see what those suppressed
 * rules would actually report.
 *
 * When run without piped input it spawns oxlint automatically.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function report(diagnostics) {
	const bySeverity = {};
	const byRule = {};

	for (const d of diagnostics) {
		bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
		const key = `${d.code} [${d.severity}]`;
		byRule[key] = (byRule[key] || 0) + 1;
	}

	const total = diagnostics.length;

	console.log('=== Severity Summary ===');
	for (const [k, v] of Object.entries(bySeverity).toSorted(([a], [b]) => a.localeCompare(b))) {
		console.log(`  ${String(v).padStart(5)}  ${k}`);
	}
	console.log(`  ${'-'.repeat(8)}`);
	console.log(`  ${String(total).padStart(5)}  total`);

	console.log('\n=== By Rule ===');
	for (const [k, v] of Object.entries(byRule).toSorted((a, b) => b[1] - a[1])) {
		console.log(`  ${String(v).padStart(5)}  ${k}`);
	}
}

function onPipeInput() {
	let buf = '';
	process.stdin.setEncoding('utf-8');
	process.stdin.on('data', (c) => (buf += c));
	process.stdin.on('end', () => {
		const start = buf.indexOf('{');
		const json = buf.slice(start, buf.lastIndexOf('}') + 1);
		try {
			report(JSON.parse(json).diagnostics);
		} catch (e) {
			console.error('Failed to parse oxlint JSON:', e.message);
			process.exit(1);
		}
	});
}

function resolveConfigPath() {
	for (const name of ['.oxlintrc.json', '.oxlintrc.jsonc']) {
		try {
			readFileSync(join(process.cwd(), name), 'utf-8');
			return join(process.cwd(), name);
		} catch {}
	}
	return null;
}

function stripAllowOff(config) {
	const cloned = structuredClone(config);
	if (cloned.rules) {
		for (const [key, val] of Object.entries(cloned.rules)) {
			if (val === 'allow' || val === 'off') {
				delete cloned.rules[key];
			}
		}
		if (Object.keys(cloned.rules).length === 0) {
			delete cloned.rules;
		}
	}
	return cloned;
}

function spawnOxlint(userArgs) {
	const args = ['oxlint', '--type-aware', '-f=json'];
	const configPath = resolveConfigPath();

	// --unfiltered: drop allow/off from .oxlintrc.json so those rules run at native severity
	if (configPath && userArgs.includes('--unfiltered')) {
		const original = JSON.parse(readFileSync(configPath, 'utf-8'));
		const stripped = stripAllowOff(original);
		const tmpDir = mkdtempSync(join(tmpdir(), 'oxlint-eff-'));
		const tempConfig = join(tmpDir, '.oxlintrc.json');
		writeFileSync(tempConfig, JSON.stringify(stripped));
		args.push('-c', tempConfig);
		userArgs = userArgs.filter((a) => a !== '--unfiltered');
	}

	// forward any extra CLI args (e.g. --no-ignore)
	args.push(...userArgs);

	const cp = spawn('npx', args, {
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: true,
	});

	let output = '';
	cp.stdout.on('data', (c) => (output += c));
	cp.stderr.on('data', (c) => (output += c));
	cp.on('close', (code) => {
		const start = output.indexOf('{');
		const json = output.slice(start, output.lastIndexOf('}') + 1);
		if (!json) {
			console.error('No JSON found in oxlint output.');
			process.exit(1);
		}
		try {
			report(JSON.parse(json).diagnostics);
		} catch (e) {
			console.error('Failed to parse oxlint JSON:', e.message);
			process.exit(1);
		}
		process.exit(code ?? 0);
	});
}

if (process.stdin.isTTY) {
	spawnOxlint(process.argv.slice(2));
} else {
	onPipeInput();
}
