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
 *   1. `before_provider_headers` — the official event. It is emitted only from
 *      the coding-agent SDK's request-options builder, so it covers the main
 *      agent loop but NOT callers that invoke `ctx.modelRegistry.streamSimple`
 *      directly. Extensions do that for side requests (e.g. pi-subagents'
 *      pruned-fork summaries), and those requests would reach OpenCode with no
 *      session header.
 *
 *   2. A registered provider wrapper — `pi.registerProvider(<provider>, …)` with
 *      a `streamSimple` that injects and delegates to the real API
 *      implementation via `getApiProvider`. This sits at the registry layer, so
 *      every caller is covered, including the direct `streamSimple` path above.
 *      It composes with the existing `models.json` entry: a registered provider
 *      that declares no `models` array leaves baseUrl, apiKey and the model list
 *      intact.
 *
 * Configuration (all optional):
 *   PI_OPENCODE_PROVIDER       provider id(s) to wrap, comma separated.
 *                              Default "Agate". The wrapper is only registered
 *                              when that provider already exists, so this file
 *                              is inert on machines without it.
 *   PI_OPENCODE_API            api id the wrapper handles. Default
 *                              "openai-completions". A provider config can only
 *                              declare one `api`; models using another api still
 *                              get layer 1 on the main-agent path.
 *   PI_OPENCODE_SESSION_STYLE  "raw" (default) or "canonical".
 *   PI_OPENCODE_NO_PROVIDER    set to 1 to disable layer 2 entirely.
 *   PI_OPENCODE_HDR_DEBUG      file path; appends one JSON line per injection.
 */

import { appendFile } from 'node:fs/promises';

import { getApiProvider } from '@earendil-works/pi-ai/compat';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { injectSessionHeaders, SESSION_HEADER, CLIENT_HEADER, type Headers, type ModelLike } from './headers.ts';
import { sessionHeaderValue, type SessionIdStyle } from './session-id.ts';

/** Provider ids whose requests get the wrapper. Comma separated. */
const WRAPPED_PROVIDERS = (process.env.PI_OPENCODE_PROVIDER ?? 'Agate')
	.split(',')
	.map((entry) => entry.trim())
	.filter(Boolean);

/** The one api id the provider wrapper handles; see the header comment. */
const WRAPPED_API = process.env.PI_OPENCODE_API ?? 'openai-completions';

/** Set `PI_OPENCODE_NO_PROVIDER=1` to fall back to the event hook alone. */
const PROVIDER_LAYER_ENABLED = process.env.PI_OPENCODE_NO_PROVIDER !== '1';

/** Default style; `PI_OPENCODE_SESSION_STYLE=canonical` overrides it per run. */
const SESSION_ID_STYLE: SessionIdStyle = process.env.PI_OPENCODE_SESSION_STYLE === 'canonical' ? 'canonical' : 'raw';

/** Opt-in verification log: set to a file path to record what was injected. */
const DEBUG_FILE = process.env.PI_OPENCODE_HDR_DEBUG;

/**
 * Latest session id, refreshed on every `session_start` (startup, new, resume,
 * fork, reload) because the registry wrapper runs outside any event context.
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

export default function (pi: ExtensionAPI) {
	// Layer 1: the official event, main-agent path.
	pi.on('before_provider_headers', async (event, ctx) => {
		const model = ctx.model;
		if (!model) return;

		// Prefer the live id here; the cached one can lag a session switch by the
		// duration of the event itself.
		currentSessionId = ctx.sessionManager.getSessionId() ?? currentSessionId;
		if (!injectSessionHeaders(event.headers, model, sessionHeaderValue(currentSessionId, SESSION_ID_STYLE))) return;

		await debugLog(describeInjection('event', model, event.headers));
	});

	// Layer 2: registry-level wrapper. Covers callers that bypass the SDK's
	// request-options builder (direct `ctx.modelRegistry.streamSimple`).
	if (!PROVIDER_LAYER_ENABLED) return;

	for (const providerId of WRAPPED_PROVIDERS) {
		let registered = false;

		pi.on('session_start', async (_event, ctx) => {
			currentSessionId = ctx.sessionManager.getSessionId() ?? currentSessionId;
			if (registered) return;

			// Register only once the provider actually exists, so an unconfigured
			// provider cannot fail pi startup.
			try {
				if (!ctx.modelRegistry.getProvider(providerId)) return;
			} catch {
				return;
			}

			try {
				pi.registerProvider(providerId, {
					api: WRAPPED_API,
					streamSimple(model, context, options) {
						const api = getApiProvider(model.api);
						if (!api) throw new Error(`pi-opencode-session-header: no API implementation for "${model.api}"`);

						const headers: Headers = { ...(options?.headers ?? {}) };
						const value = sessionHeaderValue(currentSessionId, SESSION_ID_STYLE);
						if (injectSessionHeaders(headers, model, value)) {
							void debugLog(describeInjection('provider', model, headers));
						}
						return api.streamSimple(model, context, { ...options, headers });
					},
				});
				registered = true;
			} catch (error) {
				// Never let a wrapper failure break the session; layer 1 still applies.
				await debugLog({
					at: new Date().toISOString(),
					layer: 'register-failed',
					provider: providerId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}
}
