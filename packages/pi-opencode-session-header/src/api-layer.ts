/**
 * Layer 2: the api-level wrapper.
 *
 * Pi emits `before_provider_headers` only from the coding-agent SDK's
 * request-options builder, so it covers the main agent loop but NOT callers that
 * invoke `ctx.modelRegistry.streamSimple` directly — other extensions make side
 * requests that way (e.g. pi-subagents' pruned-fork summaries). Wrapping the api
 * implementation sits *below* every caller, so those requests are covered too.
 *
 * The wrapper has to be installed while the extension factory runs. A named
 * `pi.registerProvider(...)` call made later — from a `session_start` handler,
 * say — only appends to `runtime.pendingProviderRegistrations`, and the host
 * flushes that queue once, at extension-load time, so the registration is
 * silently dropped. Wrapping the api implementation avoids that queue entirely,
 * and needs no knowledge of which provider serves the model:
 * `registerApiProvider()` is last-write-wins, so capturing the current
 * implementation and delegating to it is safe.
 *
 * Pure module: no Pi imports, so the wrapper contract can be unit-tested
 * without the host packages present.
 */

import { injectSessionHeaders, type Headers, type ModelLike } from './headers.ts';
import { sessionHeaderValue, type SessionIdStyle } from './session-id.ts';

/** Loose view of a host stream function; each host api has its own narrower type. */
export type StreamFn = (model: ModelLike, context: unknown, options: StreamOptionsLike | undefined) => unknown;

/** The only part of a stream-options object this layer looks at. */
export interface StreamOptionsLike {
	headers?: Headers;
}

/** Marks a stream function this package already installed. */
export const API_WRAP_MARKER = Symbol.for('pi-opencode-session-header/api-wrap');

/** True when `fn` is one of our wrappers, so a reload cannot wrap us twice. */
export function isWrapped(fn: unknown): boolean {
	return typeof fn === 'function' && (fn as unknown as Record<symbol, unknown>)[API_WRAP_MARKER] === true;
}

export interface ApiLayerOptions {
	/** Read at call time: this layer runs outside any event context. */
	getSessionId: () => string | undefined;
	style: SessionIdStyle;
	extraIdMatches: readonly string[];
	/** Called once per request that actually got a header, for the debug log. */
	onInject?: (layer: string, model: ModelLike, headers: Headers) => void;
}

/**
 * Wrap one stream function so matching OpenCode requests carry the session
 * header. Requests that need nothing are handed the caller's own options object,
 * so non-OpenCode traffic sees no change at all.
 */
export function wrapStreamFn(fn: StreamFn, options: ApiLayerOptions): StreamFn {
	const wrapped: StreamFn = (model, context, callOptions) => {
		const headers: Headers = { ...(callOptions?.headers ?? {}) };
		const value = sessionHeaderValue(options.getSessionId(), options.style);
		if (!injectSessionHeaders(headers, model, value, options.extraIdMatches)) {
			return fn(model, context, callOptions);
		}
		options.onInject?.('api', model, headers);
		return fn(model, context, { ...callOptions, headers });
	};
	Object.defineProperty(wrapped, API_WRAP_MARKER, { value: true });
	return wrapped;
}

/** Wrap both entry points of an api implementation. */
export function wrapApiImplementation(
	base: { stream: StreamFn; streamSimple: StreamFn },
	options: ApiLayerOptions,
): { stream: StreamFn; streamSimple: StreamFn } {
	return {
		stream: wrapStreamFn(base.stream, options),
		streamSimple: wrapStreamFn(base.streamSimple, options),
	};
}
