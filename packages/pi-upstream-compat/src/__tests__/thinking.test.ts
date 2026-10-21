import { describe, expect, it } from 'vitest';

import {
	applyThinkingCompat,
	decorateRegistryModels,
	DEFAULT_THINKING_ID_MATCHES,
	hasThinkingCompat,
	matchesThinkingModel,
	REASONING_REPLAY_FLAG,
} from '../thinking.ts';

describe('matchesThinkingModel', () => {
	it('matches a default family inside a gateway-prefixed id', () => {
		expect(matchesThinkingModel({ id: 'builtin:opencode/deepseek-v4.1-flash-free' })).toBe(true);
		expect(matchesThinkingModel({ id: 'gw/kimi-k2-thinking' })).toBe(true);
	});

	it('is case-insensitive and needs a non-empty id', () => {
		expect(matchesThinkingModel({ id: 'GLM-5.2' })).toBe(true);
		expect(matchesThinkingModel({ id: '' })).toBe(false);
		expect(matchesThinkingModel({})).toBe(false);
		expect(matchesThinkingModel({ id: 42 })).toBe(false);
	});

	it('ignores unrelated ids', () => {
		expect(matchesThinkingModel({ id: 'grok-4.7' })).toBe(false);
		expect(matchesThinkingModel({ id: 'claude-sonnet-4.5' })).toBe(false);
	});

	it('accepts extra fragments and empty matches', () => {
		expect(matchesThinkingModel({ id: 'gw/space-bunny' }, ['space'])).toBe(true);
		expect(matchesThinkingModel({ id: 'deepseek-v4' }, [])).toBe(false);
		expect(matchesThinkingModel({ id: 'deepseek-v4' }, [''])).toBe(false);
	});

	it('exposes a narrow default list', () => {
		expect(DEFAULT_THINKING_ID_MATCHES).toEqual(['deepseek', 'kimi', 'glm', 'minimax', 'mimo']);
	});
});

describe('applyThinkingCompat', () => {
	it('marks a matching model as reasoning with the replay flag', () => {
		const model: { id: string; reasoning?: boolean; compat?: Record<string, unknown> } = { id: 'deepseek-v4.1-flash' };

		expect(applyThinkingCompat(model)).toBe(model);
		expect(model.reasoning).toBe(true);
		expect(model.compat?.[REASONING_REPLAY_FLAG]).toBe(true);
	});

	it('leaves unrelated models identical', () => {
		const model = { id: 'grok-4.7' };

		expect(applyThinkingCompat(model)).toBe(model);
		expect(model).toEqual({ id: 'grok-4.7' });
	});

	it('does not override an explicit reasoning: false', () => {
		const model = { id: 'deepseek-v4', reasoning: false };

		expect(applyThinkingCompat(model)).toBe(model);
		expect(model).toEqual({ id: 'deepseek-v4', reasoning: false });
	});

	it('merges into an existing compat object and keeps other flags', () => {
		const model = { id: 'kimi-k2', compat: { supportsDeveloperRole: false } };

		applyThinkingCompat(model);

		expect(model.compat).toEqual({ supportsDeveloperRole: false, [REASONING_REPLAY_FLAG]: true });
	});

	it('is idempotent and reports no change the second time', () => {
		const model: { id: string; reasoning?: boolean; compat?: Record<string, unknown> } = { id: 'glm-5.2' };
		const first = applyThinkingCompat(model);

		expect(applyThinkingCompat(first)).toBe(model);
		expect(model.compat).toEqual({ [REASONING_REPLAY_FLAG]: true });
	});

	it('clones a frozen model instead of mutating it', () => {
		const frozen = Object.freeze({ id: 'minimax-m3', compat: Object.freeze({ supportsDeveloperRole: true }) });

		const next = applyThinkingCompat(frozen);

		expect(next).not.toBe(frozen);
		expect(next.reasoning).toBe(true);
		expect(next.compat).toEqual({ supportsDeveloperRole: true, [REASONING_REPLAY_FLAG]: true });
		expect(frozen).toEqual({ id: 'minimax-m3', compat: { supportsDeveloperRole: true } });
	});
});

describe('hasThinkingCompat', () => {
	it('requires both the reasoning flag and the replay compat', () => {
		expect(hasThinkingCompat({ id: 'deepseek-v4', reasoning: true, compat: { [REASONING_REPLAY_FLAG]: true } })).toBe(true);
		expect(hasThinkingCompat({ id: 'deepseek-v4', reasoning: true, compat: { [REASONING_REPLAY_FLAG]: false } })).toBe(false);
		expect(hasThinkingCompat({ id: 'deepseek-v4', compat: { [REASONING_REPLAY_FLAG]: true } })).toBe(false);
		expect(hasThinkingCompat({ id: 'deepseek-v4' })).toBe(false);
	});
});

describe('decorateRegistryModels', () => {
	function registry(models: unknown[], extra: Record<string, unknown> = {}) {
		return { getAll: () => models, ...extra };
	}

	it('marks every matching model in place and counts them', () => {
		const a = { id: 'Agate/deepseek-v4.1-flash' };
		const b = { id: 'Agate/kimi-k2' };
		const c = { id: 'Agate/grok-4.7' };

		expect(decorateRegistryModels(registry([a, b, c]))).toBe(2);
		expect(a).toMatchObject({ reasoning: true, compat: { [REASONING_REPLAY_FLAG]: true } });
		expect(c).toEqual({ id: 'Agate/grok-4.7' });
	});

	it('is idempotent across repeated session starts', () => {
		const model = { id: 'builtin:opencode/deepseek-v4.1-flash-free' };
		const reg = registry([model]);

		expect(decorateRegistryModels(reg)).toBe(1);
		expect(decorateRegistryModels(reg)).toBe(0);
	});

	it('respects an explicit reasoning: false', () => {
		const model = { id: 'deepseek-v4', reasoning: false };

		expect(decorateRegistryModels(registry([model]))).toBe(0);
		expect(model).toEqual({ id: 'deepseek-v4', reasoning: false });
	});

	it('falls back to getAvailable when getAll is absent', () => {
		const model = { id: 'glm-5.2' };

		expect(decorateRegistryModels({ getAvailable: () => [model] })).toBe(1);
		expect(model).toMatchObject({ reasoning: true });
	});

	it('survives a missing or throwing registry', () => {
		expect(decorateRegistryModels(undefined)).toBe(0);
		expect(
			decorateRegistryModels({
				getAll: () => {
					throw new Error('nope');
				},
			}),
		).toBe(0);
		expect(decorateRegistryModels(registry([{ id: 'glm-5.2' }]), [])).toBe(0);
	});
});
