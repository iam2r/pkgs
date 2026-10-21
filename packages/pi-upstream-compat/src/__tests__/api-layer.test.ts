import { describe, expect, it, vi } from 'vitest';

import { isWrapped, wrapApiImplementation, wrapStreamFn, type StreamFn, type StreamOptionsLike } from '../api-layer.ts';
import type { Headers, ModelLike } from '../headers.ts';

const OPENCODE_MODEL: ModelLike = { id: 'builtin:opencode/deepseek-v4.1-flash-free', provider: 'Agate' };
const OTHER_MODEL: ModelLike = { id: 'grok-4', provider: 'Agate' };

interface Call {
	model: ModelLike;
	options: StreamOptionsLike | undefined;
}

function baseFn(result = 'stream'): { fn: StreamFn; calls: Call[] } {
	const calls: Call[] = [];
	const fn: StreamFn = (model, _context, options) => {
		calls.push({ model, options });
		return result;
	};
	return { fn, calls };
}

function options(overrides: Partial<Parameters<typeof wrapStreamFn>[1]> = {}) {
	return {
		getSessionId: () => '01a142cf-8eeb-72cd-aec1-3ee2789673ef',
		style: 'raw' as const,
		extraIdMatches: [] as readonly string[],
		...overrides,
	};
}

describe('wrapStreamFn', () => {
	it('injects both headers for a matching model and delegates', () => {
		const { fn, calls } = baseFn();
		const wrapped = wrapStreamFn(fn, options());

		expect(wrapped(OPENCODE_MODEL, null, { headers: {} })).toBe('stream');
		expect(calls).toHaveLength(1);
		expect(calls[0]?.options?.headers).toEqual({
			'x-opencode-session': '01a142cf-8eeb-72cd-aec1-3ee2789673ef',
			'x-opencode-client': 'pi',
		});
	});

	it('hands non-matching traffic the caller’s own options object untouched', () => {
		const { fn, calls } = baseFn();
		const wrapped = wrapStreamFn(fn, options());
		const sent: StreamOptionsLike = { headers: { authorization: 'Bearer x' } };

		wrapped(OTHER_MODEL, null, sent);

		expect(calls[0]?.options).toBe(sent);
		expect(sent.headers).toEqual({ authorization: 'Bearer x' });
	});

	it('creates the options object when the caller passed none', () => {
		const { fn, calls } = baseFn();
		wrapStreamFn(fn, options())(OPENCODE_MODEL, null, undefined);

		// The headers have to reach the api somehow, so options is materialized.
		expect(calls[0]?.options?.headers).toMatchObject({ 'x-opencode-session': '01a142cf-8eeb-72cd-aec1-3ee2789673ef' });
	});

	it('stays inert while the session id is unknown', () => {
		const { fn, calls } = baseFn();
		const wrapped = wrapStreamFn(fn, options({ getSessionId: () => undefined }));
		const sent: StreamOptionsLike = {};

		wrapped(OPENCODE_MODEL, null, sent);

		expect(calls[0]?.options).toBe(sent);
		expect(sent.headers).toBeUndefined();
	});

	it('keeps a session header another layer already set', () => {
		const { fn, calls } = baseFn();
		const wrapped = wrapStreamFn(fn, options());

		wrapped(OPENCODE_MODEL, null, { headers: { 'x-opencode-session': 'already-there' } });

		// The existing value wins; the companion client header is still filled in.
		expect(calls[0]?.options?.headers).toEqual({ 'x-opencode-session': 'already-there', 'x-opencode-client': 'pi' });
	});

	it('honours the canonical style and extra id matches', () => {
		const { fn, calls } = baseFn();
		const wrapped = wrapStreamFn(fn, options({ style: 'canonical', extraIdMatches: ['kv'] }));

		wrapped({ id: 'gw/deepseek-kv-flash', provider: 'Agate' }, null, {});

		expect(String(calls[0]?.options?.headers?.['x-opencode-session'])).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
	});

	it('reports every injection through onInject', () => {
		const { fn } = baseFn();
		const onInject = vi.fn<(layer: string, model: ModelLike, headers: Headers) => void>();
		const wrapped = wrapStreamFn(fn, options({ onInject }));

		wrapped(OPENCODE_MODEL, null, {});
		wrapped(OTHER_MODEL, null, {});

		expect(onInject).toHaveBeenCalledTimes(1);
		expect(onInject.mock.calls[0]?.[0]).toBe('api');
		expect(onInject.mock.calls[0]?.[1]).toBe(OPENCODE_MODEL);
	});

	it('keeps unrelated options intact when it does inject', () => {
		const { fn, calls } = baseFn();
		const wrapped = wrapStreamFn(fn, options());

		wrapped(OPENCODE_MODEL, null, { maxTokens: 8, headers: { 'x-opencode-client': 'other' } });

		expect(calls[0]?.options).toMatchObject({ maxTokens: 8 });
		expect(calls[0]?.options?.headers).toMatchObject({ 'x-opencode-client': 'other' });
	});

	it('marks a thinking-family model before the implementation sees it', () => {
		const { fn, calls } = baseFn();
		const model: ModelLike & { reasoning?: boolean; compat?: Record<string, unknown> } = {
			id: 'builtin:opencode/deepseek-v4.1-flash-free',
			provider: 'Agate',
		};
		const wrapped = wrapStreamFn(fn, options({ thinkingIdMatches: ['deepseek', 'kimi'] }));

		wrapped(model, null, {});

		expect(calls[0]?.model).toBe(model);
		expect(model.reasoning).toBe(true);
		expect(model.compat?.requiresReasoningContentOnAssistantMessages).toBe(true);
	});

	it('applies thinking compat even when no session header is needed', () => {
		const { fn, calls } = baseFn();
		const model: ModelLike & { reasoning?: boolean } = { id: 'gw/deepseek-v4.1-flash', provider: 'Agate' };
		const sent: StreamOptionsLike = {};

		wrapStreamFn(fn, options({ thinkingIdMatches: ['deepseek'], getSessionId: () => undefined }))(model, null, sent);

		// Header work stays inert, model state does not.
		expect(calls[0]?.options).toBe(sent);
		expect(sent.headers).toBeUndefined();
		expect(model.reasoning).toBe(true);
	});

	it('leaves model metadata alone with no thinking matches', () => {
		const { fn } = baseFn();
		const model = { id: 'gw/deepseek-v4.1-flash', provider: 'Agate' };

		wrapStreamFn(fn, options())(model, null, {});

		expect(model).toEqual({ id: 'gw/deepseek-v4.1-flash', provider: 'Agate' });
	});

	it('marks itself so a reload cannot wrap the wrapper', () => {
		const { fn } = baseFn();
		const wrapped = wrapStreamFn(fn, options());

		expect(isWrapped(wrapped)).toBe(true);
		expect(isWrapped(fn)).toBe(false);
		expect(isWrapped(undefined)).toBe(false);
	});
});

describe('wrapApiImplementation', () => {
	it('wraps both entry points and leaves the originals usable', () => {
		const stream = baseFn('stream-result');
		const streamSimple = baseFn('stream-simple-result');
		const wrapped = wrapApiImplementation({ stream: stream.fn, streamSimple: streamSimple.fn }, options());

		expect(wrapped.stream(OPENCODE_MODEL, null, {})).toBe('stream-result');
		expect(wrapped.streamSimple(OPENCODE_MODEL, null, {})).toBe('stream-simple-result');
		expect(stream.calls[0]?.options?.headers).toHaveProperty('x-opencode-session');
		expect(streamSimple.calls[0]?.options?.headers).toHaveProperty('x-opencode-session');
		expect(isWrapped(wrapped.stream)).toBe(true);
		expect(isWrapped(wrapped.streamSimple)).toBe(true);
	});
});
