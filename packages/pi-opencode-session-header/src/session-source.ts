/**
 * Where layer 2 gets its session id.
 *
 * The cached id is not enough on its own. Extensions load in order and a package
 * extension's `session_start` handler can run before Pi has written the id onto
 * the session — a later-loaded `-e` handler in the same emission already sees
 * one. Layer 1 repairs the cache on the first main-agent request, but a side
 * request can arrive before that, so the live session and the session file name
 * (`<timestamp>_<id>.jsonl`) act as fallbacks.
 *
 * Pure module: takes a minimal session-manager shape, so the fallback chain can
 * be unit-tested without the host packages present.
 */

/** The part of a session manager this module needs. */
export interface SessionIdSource {
	getSessionId?: () => string | undefined;
	getSessionFile?: () => string | undefined;
}

const SESSION_FILE_ID = /_([0-9a-f-]{36})\.jsonl$/i;

/** Pi names session files `<timestamp>_<session id>.jsonl`. */
export function sessionIdFromFile(file: string | undefined): string | undefined {
	if (!file) return undefined;
	return SESSION_FILE_ID.exec(file)?.[1];
}

/**
 * Session id for an api-layer request: the cached value when there is one, then
 * the live session, then the session file. A context captured before a reload
 * throws when read, which counts as "no answer" rather than an error.
 */
export function resolveSessionId(cached: string | undefined, ctx: SessionIdSource | undefined): string | undefined {
	if (cached) return cached;
	if (!ctx) return undefined;

	try {
		const live = ctx.getSessionId?.();
		if (live) return live;
		return sessionIdFromFile(ctx.getSessionFile?.());
	} catch {
		return undefined;
	}
}
