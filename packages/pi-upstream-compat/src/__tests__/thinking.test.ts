import { describe, expect, it } from 'vitest';

import { applyThinkingCompat, DEFAULT_THINKING_ID_MATCHES, matchesThinkingModel, REASONING_REPLAY_FLAG } from '../thinking.ts';

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
