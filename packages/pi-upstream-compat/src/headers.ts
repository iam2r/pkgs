/**
 * Header matching and injection.
 *
 * Pure module: no Pi imports, so it can be unit-tested without the host
 * packages present.
 */

/** Substring matched against `model.id`, case-insensitively. */
export const MODEL_ID_MATCH = 'opencode';

/**
 * Normalize a comma-separated match list: trimmed, lowercased, empties dropped.
 *
 * Backs `PI_UPSTREAM_COMPAT_MODEL_MATCH`, which widens the built-in match so that a
 * gateway which renames its upstream models can still be recognised.
 */
export function parseIdMatches(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

export const SESSION_HEADER = 'x-opencode-session';
export const CLIENT_HEADER = 'x-opencode-client';
export const CLIENT_VALUE = 'pi';

/**
 * Header maps we touch. Mirrors Pi's own `ProviderHeaders`: a value is either a
 * string or null, where null means "delete this header". Absence is the only
 * representation of "not set", which is why {@link hasHeader} tests for the key
 * rather than testing the value for truthiness.
 */
export type Headers = Record<string, string | null>;

/** Model fields this module inspects. Deliberately loose so a Pi `Model` fits. */
export interface ModelLike {
	id?: unknown;
	provider?: unknown;
	baseUrl?: unknown;
}

export function hasHeader(headers: Headers, name: string): boolean {
	const expected = name.toLowerCase();
	return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}

export function hostnameOf(baseUrl: unknown): string | undefined {
	if (typeof baseUrl !== 'string') return undefined;
	try {
		return new URL(baseUrl).hostname;
	} catch {
		return undefined;
	}
}

/**
 * True for the models Pi's built-in gate already covers, plus any model id
 * mentioning "opencode" (the case this extension exists for).
 *
 * `extraIdMatches` adds further substrings, for gateways that rename their
 * upstream models so their ids no longer say "opencode" at all.
 *
 * See `pi-coding-agent/dist/core/provider-attribution.js:getSessionHeaders()`
 * for the built-in gate this mirrors and extends.
 */
export function matchesOpenCodeModel(model: ModelLike, extraIdMatches: readonly string[] = []): boolean {
	if (model.provider === 'opencode' || model.provider === 'opencode-go') return true;
	if (hostnameOf(model.baseUrl) === 'opencode.ai') return true;
	const id = typeof model.id === 'string' ? model.id.toLowerCase() : '';
	// An empty entry would make every model match, so it is never honoured.
	return id.includes(MODEL_ID_MATCH) || extraIdMatches.some((match) => match !== '' && id.includes(match));
}

/**
 * Inject in place, never overwriting a value another layer already set.
 * A null value deletes a header, so absence — not truthiness — is what we check.
 *
 * @returns true when at least one header was written.
 */
export function injectSessionHeaders(
	headers: Headers,
	model: ModelLike,
	value: string | undefined,
	extraIdMatches: readonly string[] = [],
): boolean {
	if (!value || !matchesOpenCodeModel(model, extraIdMatches)) return false;

	let injected = false;
	if (!hasHeader(headers, SESSION_HEADER)) {
		headers[SESSION_HEADER] = value;
		injected = true;
	}
	if (!hasHeader(headers, CLIENT_HEADER)) {
		headers[CLIENT_HEADER] = CLIENT_VALUE;
		injected = true;
	}
	return injected;
}
