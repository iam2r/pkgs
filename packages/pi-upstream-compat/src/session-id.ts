/**
 * OpenCode session-id derivation.
 *
 * Pure module: no Pi imports, so it can be unit-tested without the host
 * packages present.
 */

import { createHash } from 'node:crypto';

export type SessionIdStyle = 'raw' | 'canonical';

/** OpenCode's canonical session id shape: `ses_` + 12 hex + 14 base62. */
export const CANONICAL_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

/** The 12-char time part must be a descending timestamp: 9 hex, then `f[c-f]`, then 1 hex. */
export const DESCENDING_TIME_PART_RE = /^[0-9a-f]{9}f[c-f][0-9a-f]$/;

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function base62Fixed(n: bigint, width: number): string {
	let out = '';
	for (let i = 0; i < width; i++) {
		out = BASE62_ALPHABET[Number(n % 62n)] + out;
		n /= 62n;
	}
	return out;
}

/** True when `value` is already a shape-valid canonical id. */
export function isCanonicalSessionId(value: string): boolean {
	return CANONICAL_SESSION_RE.test(value) && DESCENDING_TIME_PART_RE.test(value.slice(4, 16));
}

/**
 * Deterministic `ses_…` id for an arbitrary session signal.
 *
 * The layout mirrors agate's `providers/builtins/opencode/identity.ts`, so a
 * gateway that re-derives the id from the same signal produces the same value.
 */
export function canonicalSessionId(signal: string): string {
	if (isCanonicalSessionId(signal)) return signal;

	const hex = createHash('sha256').update(`ses\0${signal}`).digest('hex');
	const byte = (i: number) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	const v =
		(BigInt(byte(0)) << 28n) | (BigInt(byte(1)) << 20n) | (BigInt(byte(2)) << 12n) | (BigInt(byte(3)) << 4n) | (BigInt(byte(4)) >> 4n);
	const timePart = (~((v << 12n) | 1n) & 0xffffffffffffn).toString(16).padStart(12, '0');
	return `ses_${timePart}${base62Fixed(BigInt(`0x${hex.slice(12, 32)}`), 14)}`;
}

/** The value actually sent in the session header, or undefined when unknown. */
export function sessionHeaderValue(sessionId: string | undefined, style: SessionIdStyle): string | undefined {
	if (!sessionId) return undefined;
	return style === 'canonical' ? canonicalSessionId(sessionId) : sessionId;
}
