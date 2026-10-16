import { describe, expect, it } from 'vitest';

import {
	CLIENT_HEADER,
	SESSION_HEADER,
	hasHeader,
	hostnameOf,
	injectSessionHeaders,
	matchesOpenCodeModel,
	type Headers,
} from '../headers.ts';

const VALUE = '01a144cf-8eeb-72cd-aec1-3ee2789673ef';

/** A gateway-served model, i.e. the case this extension exists for. */
const GATEWAY_MODEL = { id: 'builtin:opencode/deepseek-v4.1-flash-free', provider: 'Agate', baseUrl: 'https://agate.example.org/v1' };

describe('matchesOpenCodeModel', () => {
	it('matches Pi built-in opencode providers', () => {
		expect(matchesOpenCodeModel({ id: 'anything', provider: 'opencode' })).toBe(true);
		expect(matchesOpenCodeModel({ id: 'anything', provider: 'opencode-go' })).toBe(true);
	});

	it('matches the opencode.ai host', () => {
		expect(matchesOpenCodeModel({ id: 'grok-4.7', provider: 'custom', baseUrl: 'https://opencode.ai/inference/go/v1' })).toBe(true);
	});

	it('matches a gateway model whose id mentions opencode', () => {
		expect(matchesOpenCodeModel(GATEWAY_MODEL)).toBe(true);
	});

	it('matches the id case-insensitively', () => {
		expect(matchesOpenCodeModel({ id: 'OpenCode/DeepSeek', provider: 'Agate' })).toBe(true);
	});

	it('does not match unrelated models', () => {
		expect(matchesOpenCodeModel({ id: 'zmminyong/grok-4.7', provider: 'Agate', baseUrl: 'https://agate.example.org/v1' })).toBe(false);
		expect(matchesOpenCodeModel({ id: 'claude-sonnet-4-5', provider: 'anthropic', baseUrl: 'https://api.anthropic.com' })).toBe(false);
	});

	it('does not treat a lookalike host as opencode.ai', () => {
		// The built-in gate uses strict hostname equality; so do we.
		expect(matchesOpenCodeModel({ id: 'x', provider: 'custom', baseUrl: 'https://opencode.ai.evil.example/v1' })).toBe(false);
		expect(matchesOpenCodeModel({ id: 'x', provider: 'custom', baseUrl: 'https://notopencode.ai/v1' })).toBe(false);
	});

	it('tolerates missing or malformed fields', () => {
		expect(matchesOpenCodeModel({})).toBe(false);
		expect(matchesOpenCodeModel({ id: 42, provider: null, baseUrl: 'not a url' })).toBe(false);
	});
});

describe('injectSessionHeaders', () => {
	it('injects both headers for a matching model', () => {
		const headers: Headers = {};
		expect(injectSessionHeaders(headers, GATEWAY_MODEL, VALUE)).toBe(true);
		expect(headers[SESSION_HEADER]).toBe(VALUE);
		expect(headers[CLIENT_HEADER]).toBe('pi');
	});

	it('never overwrites a value another layer already set', () => {
		const headers: Headers = { [SESSION_HEADER]: 'preset', [CLIENT_HEADER]: 'other' };
		expect(injectSessionHeaders(headers, GATEWAY_MODEL, VALUE)).toBe(false);
		expect(headers[SESSION_HEADER]).toBe('preset');
		expect(headers[CLIENT_HEADER]).toBe('other');
	});

	it('treats a header name case-insensitively when checking presence', () => {
		const headers: Headers = { 'X-OpenCode-Session': 'preset' };
		injectSessionHeaders(headers, GATEWAY_MODEL, VALUE);
		expect(headers['X-OpenCode-Session']).toBe('preset');
		expect(headers[SESSION_HEADER]).toBeUndefined();
		expect(headers[CLIENT_HEADER]).toBe('pi');
	});

	it('injects nothing without a session value', () => {
		const headers: Headers = {};
		expect(injectSessionHeaders(headers, GATEWAY_MODEL, undefined)).toBe(false);
		expect(Object.keys(headers)).toEqual([]);
	});

	it('injects nothing for a non-matching model', () => {
		const headers: Headers = {};
		expect(injectSessionHeaders(headers, { id: 'zmminyong/grok-4.7', provider: 'Agate' }, VALUE)).toBe(false);
		expect(Object.keys(headers)).toEqual([]);
	});
});

describe('hasHeader', () => {
	it('matches case-insensitively', () => {
		expect(hasHeader({ 'X-Foo': '1' }, 'x-foo')).toBe(true);
		expect(hasHeader({ 'x-foo': '1' }, 'X-FOO')).toBe(true);
		expect(hasHeader({ 'x-bar': '1' }, 'x-foo')).toBe(false);
	});

	it('counts null-valued headers as present (null means delete)', () => {
		expect(hasHeader({ 'x-foo': null }, 'x-foo')).toBe(true);
	});
});

describe('hostnameOf', () => {
	it('parses valid urls', () => {
		expect(hostnameOf('https://opencode.ai/inference/go/v1')).toBe('opencode.ai');
	});

	it('returns undefined for anything else', () => {
		expect(hostnameOf(undefined)).toBeUndefined();
		expect(hostnameOf('not a url')).toBeUndefined();
		expect(hostnameOf(123)).toBeUndefined();
	});
});
