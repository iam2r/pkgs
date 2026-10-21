/**
 * pi-upstream-compat
 *
 * Two upstream quirks that Pi only handles for its own built-in providers, and
 * that surface as soon as a model is served through a third-party gateway. Both
 * decisions are made by MODEL ID here, so they work for any provider.
 *
 * 1. OpenCode session affinity. Pi only attaches OpenCode's session-affinity
 *    headers when the selected model belongs to its built-in `opencode` /
 *    `opencode-go` providers, or when the request baseUrl host is exactly
 *    `opencode.ai` — see
 *    `pi-coding-agent/dist/core/provider-attribution.js:getSessionHeaders()`.
 *    Model ids also travel through third-party gateways, e.g.
 *    `builtin:opencode/deepseek-v4.1-flash-free` served by a custom
 *    OpenAI-compatible provider. Those requests can never match that gate
 *    (`provider` is the gateway, baseUrl host is not `opencode.ai`), so Pi sends
 *    no session header at all. Upstream then answers `400 MissingSessionID`, or
 *    — when a gateway tolerates the request — mints a fresh id per request and
 *    loses prompt-cache affinity.
 *
 * 2. Thinking-mode replay. DeepSeek-family upstreams require a replayed
 *    assistant `tool_calls` turn to carry `reasoning_content`, otherwise they
 *    answer ``400 The `reasoning_content` in the thinking mode must be passed
 *    back to the API.``. Pi replays `reasoning_content: ""` when a model has
 *    `compat.requiresReasoningContentOnAssistantMessages`, which its built-in
 *    `opencode-go` / `deepseek` models set — but a gateway model carries no such
 *    metadata, and Pi's other detection is URL-based, never id-based. This
 *    extension marks matching ids as reasoning models with that flag, so Pi
 *    replays the field itself. See `thinking.ts`.
 *
 * Applying the compat happens in three places. The session's model registry is
 * decorated first, because capabilities the UI reads (`model.reasoning`) live on
 * those objects; then the two request layers below cover paths that registry
 * served models never touch.
 *
 * Two layers, because neither covers every request path on its own:
 *
 *   1. `before_provider_headers` — the official event, emitted from the SDK's
 *      request-options builder. Covers the main agent loop.
 *
 *   2. An api-level wrapper installed with `registerApiProvider()` — covers
 *      callers that bypass that builder and reach
 *      `ctx.modelRegistry.streamSimple` directly, which other extensions do for
 *      side requests (e.g. pi-subagents' pruned-fork summaries). It is installed
 *      while this factory runs *and* re-asserted on every `session_start`,
 *      because `AgentSession.reload()` clears api overrides with
 *      `resetApiProviders()`. See `api-registry.ts`.
 *
 * Layer 2 deliberately is not a `pi.registerProvider(...)` call: a named provider
 * registration made after extension loading only appends to
 * `runtime.pendingProviderRegistrations`, and the host drains that queue once,
 * while extensions load — so such a call returns normally and does nothing.
 *
 * Configuration (all optional; the pre-rename `PI_OPENCODE_*` names still work):
 *   PI_UPSTREAM_COMPAT_API            api id(s) layer 2 wraps, comma separated.
 *                                     Default "openai-completions".
 *   PI_UPSTREAM_COMPAT_SESSION_STYLE  "raw" (default) or "canonical".
 *   PI_UPSTREAM_COMPAT_MODEL_MATCH    extra model-id substrings (comma
 *                                     separated) that count as OpenCode too, for
 *                                     gateways that rename their upstream
 *                                     models. Added to the built-in "opencode"
 *                                     match.
 *   PI_UPSTREAM_COMPAT_NO_PROVIDER    set to 1 to disable layer 2 entirely.
 *   PI_UPSTREAM_COMPAT_THINKING_MATCH extra model-id family fragments that get
 *                                     the thinking-mode compat flag, added to
 *                                     the defaults (deepseek, kimi, glm,
 *                                     minimax, mimo).
 *   PI_UPSTREAM_COMPAT_NO_THINKING    set to 1 to keep model metadata untouched.
 *   PI_UPSTREAM_COMPAT_DEBUG          file path; appends one JSON line per
 *                                     injection.
 */

import { appendFile } from 'node:fs/promises';

import { getApiProvider, registerApiProvider, unregisterApiProviders } from '@earendil-works/pi-ai/compat';
import type { ApiStreamFunction, ApiStreamSimpleFunction } from '@earendil-works/pi-ai/compat';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import type { StreamFn } from './api-layer.ts';
import { createApiInstaller } from './api-registry.ts';
import { injectSessionHeaders, parseIdMatches, SESSION_HEADER, CLIENT_HEADER, type Headers, type ModelLike } from './headers.ts';
import { sessionHeaderValue, type SessionIdStyle } from './session-id.ts';
import { resolveSessionId, type SessionIdSource } from './session-source.ts';
import {
	applyThinkingCompat,
	decorateRegistryModels,
	DEFAULT_THINKING_ID_MATCHES,
	matchesThinkingModel,
	type ModelRegistryLike,
} from './thinking.ts';

/** New name first, then the pre-rename name, so existing setups keep working. */
function envVar(name: string, legacy: string): string | undefined {
	return process.env[name] ?? process.env[legacy];
}

/** api ids layer 2 wraps. Comma separated. */
const WRAPPED_APIS = parseIdMatches(envVar('PI_UPSTREAM_COMPAT_API', 'PI_OPENCODE_API') ?? 'openai-completions');

/** Set `PI_UPSTREAM_COMPAT_NO_PROVIDER=1` to fall back to the event hook alone. */
const API_LAYER_ENABLED = envVar('PI_UPSTREAM_COMPAT_NO_PROVIDER', 'PI_OPENCODE_NO_PROVIDER') !== '1';

/** Identifies our registrations in the host's api registry. */
const API_SOURCE = 'pi-upstream-compat';

/** Default style; `PI_UPSTREAM_COMPAT_SESSION_STYLE=canonical` overrides it per run. */
const SESSION_ID_STYLE: SessionIdStyle =
	envVar('PI_UPSTREAM_COMPAT_SESSION_STYLE', 'PI_OPENCODE_SESSION_STYLE') === 'canonical' ? 'canonical' : 'raw';

/** Extra id substrings that also mark a model; see `PI_UPSTREAM_COMPAT_MODEL_MATCH`. */
const EXTRA_ID_MATCHES = parseIdMatches(envVar('PI_UPSTREAM_COMPAT_MODEL_MATCH', 'PI_OPENCODE_MODEL_MATCH'));

/** Opt-in verification log: set to a file path to record what was injected. */
const DEBUG_FILE = envVar('PI_UPSTREAM_COMPAT_DEBUG', 'PI_OPENCODE_HDR_DEBUG');

/** Set `PI_UPSTREAM_COMPAT_NO_THINKING=1` to leave model metadata alone. */
const THINKING_ENABLED = process.env.PI_UPSTREAM_COMPAT_NO_THINKING !== '1';

/**
 * Id families that get the thinking-mode compat flag. The env var adds to the
 * defaults rather than replacing them, so setting one extra family cannot
 * silently switch DeepSeek off. Opt a single model out with `reasoning: false`
 * in `models.json`.
 */
const THINKING_ID_MATCHES: readonly string[] = THINKING_ENABLED
	? [...DEFAULT_THINKING_ID_MATCHES, ...parseIdMatches(process.env.PI_UPSTREAM_COMPAT_THINKING_MATCH)]
	: [];

/**
 * Latest session id, refreshed on every `session_start` (startup, new, resume,
 * fork, reload) because the api wrapper runs outside any event context.
 */
let currentSessionId: string | undefined;

/** Session manager from the most recent event, for the lazy id fallback. */
let currentCtx: SessionIdSource | undefined;

/**
 * Session id for a layer-2 request: the cache when it is populated, otherwise
 * the live session. See `session-source.ts`.
 */
function currentOrLiveSessionId(): string | undefined {
	const resolved = resolveSessionId(currentSessionId, currentCtx);
	if (resolved) currentSessionId = resolved;
	return resolved;
}

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
		thinking: matchesThinkingModel(model, THINKING_ID_MATCHES),
		[SESSION_HEADER]: headers[SESSION_HEADER] ?? null,
		[CLIENT_HEADER]: headers[CLIENT_HEADER] ?? null,
	};
}

/**
 * Layer 0: mark the session's models, so what the UI reads (`model.reasoning`
 * drives thinking levels) agrees with what the request builder will do. The api
 * layer still marks the exact model per request, which covers models a gateway
 * adds after startup.
 */
function decorateSessionModels(registry: ModelRegistryLike | undefined, provider: string | undefined): void {
	// Scoped to the provider in use: the registry also carries every built-in
	// provider's catalog, where an id alone is not enough to change capabilities.
	const changed = decorateRegistryModels(registry, THINKING_ID_MATCHES, { provider });
	if (changed > 0) void debugLog({ at: new Date().toISOString(), layer: 'registry', provider, models: changed });
}

/**
 * Layer 2: wrap the api implementation so every caller is covered, including
 * direct `ctx.modelRegistry.streamSimple` calls. Installed while this factory
 * runs and re-asserted on every `session_start`; see `api-registry.ts`.
 */
const installer = createApiInstaller({
	registry: {
		get: (api) => getApiProvider(api) as { stream: StreamFn; streamSimple: StreamFn } | undefined,
		register: (api, implementation, sourceId) =>
			registerApiProvider(
				{
					api: api,
					stream: implementation.stream as unknown as ApiStreamFunction,
					streamSimple: implementation.streamSimple as unknown as ApiStreamSimpleFunction,
				},
				sourceId,
			),
		unregister: (sourceId) => unregisterApiProviders(sourceId),
	},
	apis: WRAPPED_APIS,
	sourceId: API_SOURCE,
	layer: {
		getSessionId: currentOrLiveSessionId,
		style: SESSION_ID_STYLE,
		extraIdMatches: EXTRA_ID_MATCHES,
		thinkingIdMatches: THINKING_ID_MATCHES,
		onInject: (layer, model, headers) => void debugLog(describeInjection(layer, model, headers)),
	},
	report: (event) => void debugLog({ at: new Date().toISOString(), ...event }),
});

export default function (pi: ExtensionAPI) {
	// Layer 1: the official event, main-agent path.
	pi.on('before_provider_headers', async (event, ctx) => {
		const model = ctx.model;
		if (!model) return;

		// Thinking compat changes model state, not headers: mark it here too, so the
		// main-agent path does not depend on layer 2 having seen this model first.
		applyThinkingCompat(model, THINKING_ID_MATCHES);
		decorateSessionModels(ctx.modelRegistry, model.provider);

		// Prefer the live id here; the cached one can lag a session switch by the
		// duration of the event itself.
		currentCtx = ctx.sessionManager;
		const live = ctx.sessionManager.getSessionId();
		currentSessionId = live ?? currentSessionId;
		if (!injectSessionHeaders(event.headers, model, sessionHeaderValue(currentSessionId, SESSION_ID_STYLE), EXTRA_ID_MATCHES)) return;

		await debugLog(describeInjection('event', model, event.headers));
	});

	// Layer 2: the session id the api wrapper sends, plus the wrapper itself. A
	// side request can arrive before any main-agent request, so neither may depend
	// on layer 1 firing.
	pi.on('session_start', (_event, ctx) => {
		currentCtx = ctx.sessionManager;
		currentSessionId = ctx.sessionManager.getSessionId() ?? currentSessionId;

		// Capabilities the UI reads come from these objects.
		decorateSessionModels(ctx.modelRegistry, ctx.model?.provider);

		// Re-assert the wrapper here: the host's own bootstrap runs after the
		// extension factories and replaces the api-registry entry installed then.
		if (API_LAYER_ENABLED) installer();
	});

	// A model picked mid-session is marked before its first turn, so the thinking
	// UI and the request builder agree without waiting for a request to happen.
	pi.on('model_select', (_event, ctx) => decorateSessionModels(ctx.modelRegistry, ctx.model?.provider));

	if (!API_LAYER_ENABLED) return;
	installer();
}
