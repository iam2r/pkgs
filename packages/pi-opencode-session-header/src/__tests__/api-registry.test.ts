import { describe, expect, it } from 'vitest';

import { isWrapped, type StreamFn } from '../api-layer.ts';
import { createApiInstaller, type ApiRegistry } from '../api-registry.ts';
import type { ModelLike } from '../headers.ts';

const API = 'openai-completions';

/** A stand-in for the host api registry, including its last-write-wins behaviour. */
function fakeRegistry(initial?: { stream: StreamFn; streamSimple: StreamFn }) {
	const providers = new Map<string, { stream: StreamFn; streamSimple: StreamFn }>();
	// Ownership is per entry, like the host's `{provider, sourceId}` records: a host
	// write replaces the entry *and* its owner, so a later unregister cannot delete it.
	const owners = new Map<string, string | undefined>();

	const setHostImpl = (api: string, implementation: { stream: StreamFn; streamSimple: StreamFn }) => {
		providers.set(api, implementation);
		owners.set(api, undefined);
	};
	if (initial) setHostImpl(API, initial);

	const registry: ApiRegistry = {
		get: (api) => providers.get(api),
		register: (api, implementation, sourceId) => {
			providers.set(api, implementation);
			owners.set(api, sourceId);
		},
		unregister: (sourceId) => {
			for (const [api, owner] of owners) {
				if (owner === sourceId) {
					providers.delete(api);
					owners.delete(api);
				}
			}
		},
	};

	return { registry, providers, setHostImpl };
}

function stubBase(result = 'base-result'): { impl: { stream: StreamFn; streamSimple: StreamFn }; calls: Array<ModelLike> } {
	const calls: Array<ModelLike> = [];
	const fn: StreamFn = (model) => {
		calls.push(model);
		return result;
	};
	return { impl: { stream: fn, streamSimple: fn }, calls };
}

function installer(registry: ApiRegistry, report: Array<Record<string, unknown>> = []) {
	return {
		report,
		install: createApiInstaller({
			registry,
			apis: [API],
			sourceId: 'pi-opencode-session-header',
			layer: {
				getSessionId: () => '01a142cf-8eeb-72cd-aec1-3ee2789673ef',
				style: 'raw',
				extraIdMatches: [],
			},
			report: (event) => report.push(event),
		}),
	};
}

const MODEL: ModelLike = { id: 'builtin:opencode/deepseek-v4.1-flash-free', provider: 'Agate' };

describe('createApiInstaller', () => {
	it('wraps the host implementation and reports the install', () => {
		const { registry, providers } = fakeRegistry(stubBase().impl);
		const { install, report } = installer(registry);

		install();

		expect(report).toEqual([{ layer: 'api-installed', api: API }]);
		expect(isWrapped(providers.get(API)?.streamSimple)).toBe(true);
	});

	it('re-asserts after the host replaced our entry, capturing the new base', () => {
		const first = stubBase('first');
		const { registry, providers, setHostImpl } = fakeRegistry(first.impl);
		const { install, report } = installer(registry);
		install();

		// The host bootstrap rebuilds its own implementation, dropping ours.
		const rebuilt = stubBase('rebuilt');
		setHostImpl(API, rebuilt.impl);
		install();

		expect(report.at(-1)).toEqual({ layer: 'api-installed', api: API });
		expect(isWrapped(providers.get(API)?.streamSimple)).toBe(true);
		// The renewed wrapper delegates to the rebuilt implementation, not the old one.
		expect(providers.get(API)?.streamSimple(MODEL, null, {})).toBe('rebuilt');
		expect(rebuilt.calls).toHaveLength(1);
		expect(first.calls).toHaveLength(0);
	});

	it('re-installs without stacking wrappers when nothing changed', () => {
		const base = stubBase();
		const { registry, providers } = fakeRegistry(base.impl);
		const { install, report } = installer(registry);

		install();
		install();
		install();

		expect(report.map((event) => event['layer'])).toEqual(['api-installed', 'api-reinstalled', 'api-reinstalled']);
		// One delegation, not three: the wrapper never wraps itself.
		expect(providers.get(API)?.streamSimple(MODEL, null, {})).toBe('base-result');
		expect(base.calls).toHaveLength(1);
	});

	it('keeps reporting but does not register when the api id is unknown', () => {
		const { registry, providers } = fakeRegistry();
		const { install, report } = installer(registry);

		install();

		expect(report).toEqual([{ layer: 'api-missing', api: API }]);
		expect(providers.size).toBe(0);
	});

	it('survives a registry that throws and reports it', () => {
		const { registry } = fakeRegistry(stubBase().impl);
		const { install, report } = installer({
			...registry,
			register: () => {
				throw new Error('registry exploded');
			},
		});

		expect(() => install()).not.toThrow();
		expect(report.at(-1)).toEqual({ layer: 'api-failed', api: API, error: 'registry exploded' });
	});
});
