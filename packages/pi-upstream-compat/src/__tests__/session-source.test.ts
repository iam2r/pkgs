import { describe, expect, it } from 'vitest';

import { resolveSessionId, sessionIdFromFile } from '../session-source.ts';

const ID = '01a142cf-8eeb-72cd-aec1-3ee2789673ef';
const FILE = `/home/razo/.pi/agent/sessions/--home-razo--/2026-10-16T03-44-21-227Z_${ID}.jsonl`;

describe('sessionIdFromFile', () => {
	it('reads the id out of a session file name', () => {
		expect(sessionIdFromFile(FILE)).toBe(ID);
	});

	it('ignores files that do not follow the naming scheme', () => {
		expect(sessionIdFromFile(undefined)).toBeUndefined();
		expect(sessionIdFromFile('/tmp/session.jsonl')).toBeUndefined();
		expect(sessionIdFromFile('/tmp/2026-10-16T03-44-21-227Z_nothex.jsonl')).toBeUndefined();
	});
});

describe('resolveSessionId', () => {
	it('prefers the cached id, so a switch does not have to reach the manager', () => {
		const ctx = { getSessionId: () => 'from-live' };
		expect(resolveSessionId('cached', ctx)).toBe('cached');
	});

	it('reads the live session when the cache is empty', () => {
		expect(resolveSessionId(undefined, { getSessionId: () => ID })).toBe(ID);
	});

	it('falls back to the session file when the live session has no id yet', () => {
		// The case that broke layer 2: a `session_start` handler that runs before
		// Pi writes the id onto the session.
		expect(resolveSessionId(undefined, { getSessionId: () => undefined, getSessionFile: () => FILE })).toBe(ID);
	});

	it('treats a stale context as no answer instead of failing the request', () => {
		const ctx = {
			getSessionId: () => {
				throw new Error('This extension ctx is stale after session replacement or reload.');
			},
		};
		expect(resolveSessionId(undefined, ctx)).toBeUndefined();
		expect(resolveSessionId('cached', ctx)).toBe('cached');
	});

	it('has no answer without a session at all', () => {
		expect(resolveSessionId(undefined, undefined)).toBeUndefined();
		expect(resolveSessionId(undefined, {})).toBeUndefined();
	});
});
