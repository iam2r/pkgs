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
 * replays the field itself. It merges into an existing `compat` object and never
 * touches a model that Pi's own catalog already defines — for those, Pi's
 * metadata is the better answer.
 *
 * Two places apply it: the session's model registry (so thinking levels and the
 * picker agree with the request builder) and the request itself (so the model a
 * gateway added after startup is covered too).
 *
 * Caveat: marking a model as reasoning is not free — Pi unlocks its thinking
 * levels for it. The defaults therefore stay narrow (families where thinking
 * mode is certain); extend them with `PI_UPSTREAM_COMPAT_THINKING_MATCH` and
 * skip ids with `PI_UPSTREAM_COMPAT_THINKING_EXCLUDE`.
 *
 * `reasoning: false` cannot express an opt-out: Pi's provider composer fills that
 * default for every model declared in `models.json` without one, so it is the
 * normal state of the gateway models this module exists for.
 */

import { getBuiltinModel } from '@earendil-works/pi-ai/providers/all';

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

/** Untyped view: the generated catalog only accepts known provider/id literals. */
const lookupBuiltinModel = getBuiltinModel as unknown as (provider: string, modelId: string) => unknown;

/** Model-id fragments that opt a model back out. */
export interface ThinkingCompatOptions {
	/** Id fragments that must keep their metadata as-is. */
	exclude?: readonly string[];
}

/**
 * True when Pi's own catalog already defines this provider/model pair.
 *
 * Those models ship with curated `reasoning` / `compat` metadata, and guessing
 * over it by id would redesignate, say, a non-thinking `deepseek-chat` as a
 * reasoning model. `getBuiltinModel` is the same table the host composes from.
 */
export function isBuiltinModel(model: ThinkingModelLike): boolean {
	const provider = typeof model.provider === 'string' ? model.provider : undefined;
	const id = typeof model.id === 'string' ? model.id : undefined;
	if (!provider || !id) return false;
	try {
		return lookupBuiltinModel(provider, id) !== undefined;
	} catch {
		return false;
	}
}

/** True when `model.id` mentions one of `matches` (case-insensitive, non-empty). */
export function matchesThinkingModel(model: ThinkingModelLike, matches: readonly string[] = DEFAULT_THINKING_ID_MATCHES): boolean {
	const id = typeof model.id === 'string' ? model.id.toLowerCase() : '';
	if (!id) return false;
	return matches.some((match) => match !== '' && id.includes(match));
}

/** True when `model.id` mentions one of `exclude` (case-insensitive, non-empty). */
function isExcluded(model: ThinkingModelLike, exclude: readonly string[] | undefined): boolean {
	if (!exclude || exclude.length === 0) return false;
	return matchesThinkingModel(model, exclude);
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

/** Narrows registry decoration. */
export interface DecorateOptions extends ThinkingCompatOptions {
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
			if (!matchesThinkingModel(model, matches) || isExcluded(model, options.exclude)) continue;
			if (hasThinkingCompat(model)) continue;
			if (hasThinkingCompat(applyThinkingCompat(model, matches, options))) changed++;
		}
		return changed;
	} catch {
		return 0;
	}
}

/**
 * Mark a matching model as a reasoning model with the replay flag.
 *
 * - built-in models are left alone: Pi's catalog knows them better than an id
 * - an existing `compat` object is merged, never replaced
 * - when nothing needs to change the SAME object is returned, so callers can
 *   compare identity to know whether they touched it
 * - frozen models are never mutated: a shallow copy is returned instead
 */
export function applyThinkingCompat<M extends ThinkingModelLike>(
	model: M,
	matches: readonly string[] = DEFAULT_THINKING_ID_MATCHES,
	options: ThinkingCompatOptions = {},
): M {
	if (isBuiltinModel(model)) return model;
	if (!matchesThinkingModel(model, matches) || isExcluded(model, options.exclude)) return model;

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
	model.reasoning = true;
	model.compat = nextCompat;
	return model;
}

function providerOf(model: ThinkingModelLike): string | undefined {
	return typeof model.provider === 'string' ? model.provider : undefined;
}
