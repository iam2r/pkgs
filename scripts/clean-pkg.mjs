#!/usr/bin/env node
import { existsSync } from 'node:fs';
/**
 * clean:pkg — remove build output for all packages.
 *
 * Deletes every package's dist directory (the build:pkg output) so the next
 * `pnpm build:pkg` starts from a clean slate. Keeps `.turbo` caches
 * intact so turbo can restore previously built outputs.
 */
import { rm } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');

const entries = await readdir(packagesDir, { withFileTypes: true });
const removed = [];

for (const entry of entries) {
	if (!entry.isDirectory()) continue;
	const distDir = join(packagesDir, entry.name, 'dist');
	if (!existsSync(distDir)) continue;
	await rm(distDir, { recursive: true, force: true });
	removed.push(entry.name);
}

if (removed.length === 0) {
	console.log('clean:pkg — nothing to clean (no packages/*/dist found)');
} else {
	console.log(`clean:pkg — removed dist from: ${removed.join(', ')}`);
}
