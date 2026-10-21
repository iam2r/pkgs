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
