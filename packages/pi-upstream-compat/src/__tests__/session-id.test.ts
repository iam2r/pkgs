import { describe, expect, it } from 'vitest';

import {
	CANONICAL_SESSION_RE,
	DESCENDING_TIME_PART_RE,
	canonicalSessionId,
	isCanonicalSessionId,
	sessionHeaderValue,
} from '../session-id.ts';

/** A real Pi session id, as seen in `~/.pi/agent/sessions/**`. */
const PI_SESSION = '01a144cf-8eeb-72cd-aec1-3ee2789673ef';

/**
 * Golden vector captured from a live run: three consecutive turns of one Pi
 * session produced exactly this value. It pins the derivation so a refactor
 * cannot silently change what upstream sees (which would break cache affinity).
 */
const GOLDEN = 'ses_2afc3e577ffe0d3KSr499nnFgr';

describe('canonicalSessionId', () => {
	it('reproduces the live golden vector', () => {
		expect(canonicalSessionId(PI_SESSION)).toBe(GOLDEN);
	});

	it('produces a shape-valid id', () => {
		const id = canonicalSessionId(PI_SESSION);
		expect(CANONICAL_SESSION_RE.test(id)).toBe(true);
		expect(DESCENDING_TIME_PART_RE.test(id.slice(4, 16))).toBe(true);
	});

	it('is deterministic for the same signal', () => {
		expect(canonicalSessionId(PI_SESSION)).toBe(canonicalSessionId(PI_SESSION));
	});

	it('is idempotent for an already-canonical id', () => {
		expect(isCanonicalSessionId(GOLDEN)).toBe(true);
		expect(canonicalSessionId(GOLDEN)).toBe(GOLDEN);
	});

	it('separates different signals', () => {
		expect(canonicalSessionId('session-a')).not.toBe(canonicalSessionId('session-b'));
	});

	it('rejects malformed canonical ids', () => {
		const tail = 'KSr499nnFgrAbC';
		expect(tail).toHaveLength(14);
		// Right shape, but an ascending time part instead of a descending one.
		expect(isCanonicalSessionId(`ses_000000000001${tail}`)).toBe(false);
		// Non-hex time part.
		expect(isCanonicalSessionId(`ses_zzzzzzzzzzzz${tail}`)).toBe(false);
		// Too short overall (13 trailing chars instead of 14).
		expect(isCanonicalSessionId(`ses_2afc3e577ffe0d3${'K'.repeat(13)}`)).toBe(false);
		// Not a ses_ id at all.
		expect(isCanonicalSessionId(PI_SESSION)).toBe(false);
	});
});

describe('sessionHeaderValue', () => {
	it('returns undefined without a session id', () => {
		expect(sessionHeaderValue(undefined, 'raw')).toBeUndefined();
		expect(sessionHeaderValue(undefined, 'canonical')).toBeUndefined();
	});

	it('passes the Pi session id through in raw style', () => {
		expect(sessionHeaderValue(PI_SESSION, 'raw')).toBe(PI_SESSION);
	});

	it('canonicalises in canonical style', () => {
		expect(sessionHeaderValue(PI_SESSION, 'canonical')).toBe(GOLDEN);
	});
});
