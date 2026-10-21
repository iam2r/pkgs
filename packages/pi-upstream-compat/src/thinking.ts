/**
 * Thinking-mode compatibility.
 *
 * DeepSeek-family thinking upstreams reject a replayed turn whose assistant
 * `tool_calls` message carries no `reasoning_content`:
 *
 *   400 "The `reasoning_content` in the thinking mode must be passed back to the API."
 *
 * Pi knows how to satisfy that — its built-in `opencode-go` / `deepseek` models
 * carry `compat.requiresReasoningContentOnAssistantMessages: true`, which makes
 * the request builder replay `reasoning_content: ""` on assistant turns. A model
 * declared for a third-party gateway carries no such metadata, and Pi's default
 * detection is URL-based (`opencode.ai`, `api.deepseek.com`), never id-based, so
 * through a gateway the flag stays off.
 *
 * This module decides by MODEL ID: an id containing one of the configured family
 * fragments is marked as a reasoning model and receives the compat flag, so Pi
 * replays the field itself. It never overrides an explicit `reasoning: false`
 * and merges into an existing `compat` object.
 *
 * Two places apply it: the session's model registry (so thinking levels and the
 * picker agree with the request builder) and the request itself (so the model a
 * gateway added after startup is covered too).
 *
 * Caveat: marking a model as reasoning is not free — Pi unlocks its thinking
 * levels for it. The defaults therefore stay narrow (families where thinking
 * mode is certain); extend them with `PI_UPSTREAM_COMPAT_THINKING_MATCH`, and use
 * `reasoning: false` in `models.json` to opt one model out.
 *
 * Pure module: no Pi imports, so it can be unit-tested without the host packages
 * present.
 */

/** Default model-id fragments that identify a thinking-mode upstream family. */
export const DEFAULT_THINKING_ID_MATCHES: readonly string[] = ['deepseek', 'kimi', 'glm', 'minimax', 'mimo'];

/** Model fields this module inspects. Deliberately loose so a Pi `Model` fits. */
export interface ThinkingModelLike {
	id?: unknown;
	provider?: unknown;
	reasoning?: unknown;
	compat?: unknown;
}

/** The compat flag Pi's request builder reads. */
export const REASONING_REPLAY_FLAG = 'requiresReasoningContentOnAssistantMessages';

/** True when `model.id` mentions one of `matches` (case-insensitive, non-empty). */
export function matchesThinkingModel(model: ThinkingModelLike, matches: readonly string[] = DEFAULT_THINKING_ID_MATCHES): boolean {
	const id = typeof model.id === 'string' ? model.id.toLowerCase() : '';
	if (!id) return false;
	return matches.some((match) => match !== '' && id.includes(match));
}

/** True when the model already carries everything this module would set. */
export function hasThinkingCompat(model: ThinkingModelLike): boolean {
	if (model.reasoning !== true) return false;
	const compat = model.compat && typeof model.compat === 'object' ? (model.compat as Record<string, unknown>) : undefined;
	return compat?.[REASONING_REPLAY_FLAG] === true;
}

/** The slice of Pi's `ModelRegistry` this module needs. */
export interface ModelRegistryLike {
	getAll?: () => readonly ThinkingModelLike[];
	getAvailable?: () => readonly ThinkingModelLike[];
}

/** Narrows registry decoration; `provider` keeps built-in catalogs untouched. */
export interface DecorateOptions {
	/** Only decorate models of this provider, e.g. the session's current one. */
	provider?: string;
}

/**
 * Apply the compat to every matching model the registry holds, in place, and
 * return how many changed.
 *
 * Sessions read capabilities off these objects (`AgentSession.supportsThinking`
 * checks `this.model.reasoning`), so decorating the registry is what makes the
 * thinking levels and the model picker agree with what the request builder will
 * do. Request-time application in `api-layer.ts` stays as the guarantee for
 * models the registry does not know about.
 *
 * Pass `provider` to scope it to the provider a session is actually using: the
 * registry also holds every built-in provider's catalog, and redesignating, say,
 * `deepseek-chat` as a reasoning model because of its id would be wrong there.
 *
 * Never throws: a session must start even if a registry shape changed.
 */
export function decorateRegistryModels(
	registry: ModelRegistryLike | undefined,
	matches: readonly string[] = DEFAULT_THINKING_ID_MATCHES,
	options: DecorateOptions = {},
): number {
	if (!registry || matches.length === 0) return 0;
	try {
		const models = registry.getAll?.() ?? registry.getAvailable?.() ?? [];
		let changed = 0;
		for (const model of models) {
			if (options.provider !== undefined && providerOf(model) !== options.provider) continue;
			if (!matchesThinkingModel(model, matches) || hasThinkingCompat(model)) continue;
			// Explicit `reasoning: false` wins, so a refused apply changes nothing.
			if (hasThinkingCompat(applyThinkingCompat(model, matches))) changed++;
		}
		return changed;
	} catch {
		return 0;
	}
}

function providerOf(model: ThinkingModelLike): string | undefined {
	return typeof model.provider === 'string' ? model.provider : undefined;
}

/**
 * Mark a matching model as a reasoning model with the replay flag.
 *
 * - explicit `reasoning: false` wins (per-model opt-out from `models.json`)
 * - an existing `compat` object is merged, never replaced
 * - when nothing needs to change the SAME object is returned, so callers can
 *   compare identity to know whether they touched it
 * - frozen models are never mutated: a shallow copy is returned instead
 */
export function applyThinkingCompat<M extends ThinkingModelLike>(model: M, matches: readonly string[] = DEFAULT_THINKING_ID_MATCHES): M {
	if (!matchesThinkingModel(model, matches)) return model;
	if (model.reasoning === false) return model;

	const compat = (model.compat && typeof model.compat === 'object' ? model.compat : {}) as Record<string, unknown>;
	const needsReasoning = model.reasoning !== true;
	const needsFlag = compat[REASONING_REPLAY_FLAG] !== true;
	if (!needsReasoning && !needsFlag) return model;

	const nextCompat = needsFlag ? { ...compat, [REASONING_REPLAY_FLAG]: true } : compat;
	if (Object.isFrozen(model)) {
		return { ...model, reasoning: true, compat: nextCompat };
	}
	// The request builder reads these fields off the model object it receives, so
	// mutating in place is enough — and keeps identity-based model lookups intact.
	(model as ThinkingModelLike).reasoning = true;
	(model as ThinkingModelLike).compat = nextCompat;
	return model;
}
