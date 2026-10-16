/**
 * pi-opencode-session-header
 *
 * Pi only attaches OpenCode's session-affinity headers when the selected model
 * belongs to its own built-in `opencode` / `opencode-go` providers, or when the
 * request baseUrl host is exactly `opencode.ai` — see
 * `pi-coding-agent/dist/core/provider-attribution.js:getSessionHeaders()`.
 *
 * Model ids also travel through third-party gateways, e.g.
 * `builtin:opencode/deepseek-v4.1-flash-free` served by a custom
 * OpenAI-compatible provider. Those requests can never match that gate
 * (`provider` is the gateway, baseUrl host is not `opencode.ai`), so Pi sends no
 * session header at all. Upstream then answers `400 MissingSessionID`, or — when
 * a gateway tolerates the request — mints a fresh id per request and loses
 * prompt-cache affinity. This extension re-applies the same header logic
 * whenever the model id mentions "opencode".
 *
 * Two layers, because neither covers every request path on its own:
 *
 *   1. `before_provider_headers` — the official event, emitted from the SDK's
 *      request-options builder. Covers the main agent loop.
 *
 *   2. An api-level wrapper installed with `registerApiProvider()` — covers
 *      callers that bypass that builder and reach
 *      `ctx.modelRegistry.streamSimple` directly, which other extensions do for
 *      side requests (e.g. pi-subagents' pruned-fork summaries).
 *
 * Layer 2 must be installed *while this factory runs*: a named
 * `pi.registerProvider(...)` call made later (say from a `session_start`
 * handler) only appends to `runtime.pendingProviderRegistrations`, and the host
 * flushes that queue once, at extension-load time, so such a call is silently
 * dropped. See `api-layer.ts` for the trace; `README.md` has the same note.
 *
 * Configuration (all optional):
 *   PI_OPENCODE_API            api id(s) layer 2 wraps, comma separated.
 *                              Default "openai-completions".
 *   PI_OPENCODE_SESSION_STYLE  "raw" (default) or "canonical".
 *   PI_OPENCODE_MODEL_MATCH    extra model-id substrings (comma separated) that
 *                              count as OpenCode too, for gateways that rename
 *                              their upstream models. Added to the built-in
 *                              "opencode" match.
 *   PI_OPENCODE_NO_PROVIDER    set to 1 to disable layer 2 entirely.
 *   PI_OPENCODE_HDR_DEBUG      file path; appends one JSON line per injection.
 */

import { appendFile } from 'node:fs/promises';

import { getApiProvider, registerApiProvider } from '@earendil-works/pi-ai/compat';
import type { ApiStreamFunction, ApiStreamSimpleFunction } from '@earendil-works/pi-ai/compat';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { isWrapped, wrapApiImplementation, type StreamFn } from './api-layer.ts';
import { injectSessionHeaders, parseIdMatches, SESSION_HEADER, CLIENT_HEADER, type Headers, type ModelLike } from './headers.ts';
import { sessionHeaderValue, type SessionIdStyle } from './session-id.ts';

/** api ids layer 2 wraps. Comma separated. */
const WRAPPED_APIS = parseIdMatches(process.env.PI_OPENCODE_API ?? 'openai-completions');

/** Set `PI_OPENCODE_NO_PROVIDER=1` to fall back to the event hook alone. */
const API_LAYER_ENABLED = process.env.PI_OPENCODE_NO_PROVIDER !== '1';

/** Identifies our registrations in the host's api registry. */
const API_SOURCE = 'pi-opencode-session-header';

/** Default style; `PI_OPENCODE_SESSION_STYLE=canonical` overrides it per run. */
const SESSION_ID_STYLE: SessionIdStyle = process.env.PI_OPENCODE_SESSION_STYLE === 'canonical' ? 'canonical' : 'raw';

/** Extra id substrings that also mark a model; see `PI_OPENCODE_MODEL_MATCH`. */
const EXTRA_ID_MATCHES = parseIdMatches(process.env.PI_OPENCODE_MODEL_MATCH);

/** Opt-in verification log: set to a file path to record what was injected. */
const DEBUG_FILE = process.env.PI_OPENCODE_HDR_DEBUG;

/**
 * Latest session id, refreshed on every `session_start` (startup, new, resume,
 * fork, reload) because the api wrapper runs outside any event context.
 */
let currentSessionId: string | undefined;

async function debugLog(entry: Record<string, unknown>): Promise<void> {
	if (!DEBUG_FILE) return;
	try {
		await appendFile(DEBUG_FILE, `${JSON.stringify(entry)}\n`);
	} catch {
		// Debug logging must never break a request.
	}
}

function describeInjection(layer: string, model: ModelLike, headers: Headers): Record<string, unknown> {
	return {
		at: new Date().toISOString(),
		layer,
		provider: model.provider,
		modelId: model.id,
		style: SESSION_ID_STYLE,
		sessionId: currentSessionId,
		[SESSION_HEADER]: headers[SESSION_HEADER] ?? null,
		[CLIENT_HEADER]: headers[CLIENT_HEADER] ?? null,
	};
}

/**
 * Layer 2: wrap the api implementation so every caller is covered, including
 * direct `ctx.modelRegistry.streamSimple` calls.
 *
 * Runs during extension loading, which is the only time the host still applies a
 * provider registration; wrapping the api implementation sidesteps that queue
 * and needs no provider id at all.
 */
function installApiLayer(): void {
	for (const api of WRAPPED_APIS) {
		try {
			const base = getApiProvider(api) as { stream: StreamFn; streamSimple: StreamFn } | undefined;

			if (!base) {
				void debugLog({ at: new Date().toISOString(), layer: 'api-missing', api });
				continue;
			}
			if (typeof base.stream !== 'function' || typeof base.streamSimple !== 'function') {
				void debugLog({ at: new Date().toISOString(), layer: 'api-incomplete', api });
				continue;
			}
			// A reload can run this factory twice; never wrap our own wrapper.
			if (isWrapped(base.stream) || isWrapped(base.streamSimple)) continue;

			const wrapped = wrapApiImplementation(base, {
				getSessionId: () => currentSessionId,
				style: SESSION_ID_STYLE,
				extraIdMatches: EXTRA_ID_MATCHES,
				onInject: (layer, model, headers) => void debugLog(describeInjection(layer, model, headers)),
			});

			registerApiProvider(
				{
					api: api,
					stream: wrapped.stream as unknown as ApiStreamFunction,
					streamSimple: wrapped.streamSimple as unknown as ApiStreamSimpleFunction,
				},
				API_SOURCE,
			);
			void debugLog({ at: new Date().toISOString(), layer: 'api-installed', api });
		} catch (error) {
			// Never let a wrapper failure break the session; layer 1 still applies.
			void debugLog({
				at: new Date().toISOString(),
				layer: 'api-failed',
				api,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

export default function (pi: ExtensionAPI) {
	// Layer 1: the official event, main-agent path.
	pi.on('before_provider_headers', async (event, ctx) => {
		const model = ctx.model;
		if (!model) return;

		// Prefer the live id here; the cached one can lag a session switch by the
		// duration of the event itself.
		currentSessionId = ctx.sessionManager.getSessionId() ?? currentSessionId;
		if (!injectSessionHeaders(event.headers, model, sessionHeaderValue(currentSessionId, SESSION_ID_STYLE), EXTRA_ID_MATCHES)) return;

		await debugLog(describeInjection('event', model, event.headers));
	});

	// Layer 2: the session id the api wrapper sends. A side request can happen
	// before any main-agent request, so this must not depend on layer 1 firing.
	pi.on('session_start', (_event, ctx) => {
		currentSessionId = ctx.sessionManager.getSessionId() ?? currentSessionId;
	});

	if (!API_LAYER_ENABLED) return;
	installApiLayer();
}
