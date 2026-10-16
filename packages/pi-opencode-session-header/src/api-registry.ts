/**
 * (Re)installing the api-level wrapper into the host's api registry.
 *
 * The wrapper cannot be installed once and forgotten. Pi's own bootstrap runs
 * after the extension factories and replaces the api-registry entry we wrote, so
 * a registration made at extension-load time is gone by the time a session
 * starts. Re-asserting it on every `session_start` fixes that.
 *
 * The host registry is a single slot per api and does not expose who owns an
 * entry, so the installer keeps the implementation it wrapped and uses
 * `unregister` as its test: dropping `sourceId` removes our entry if we still
 * own it, which leaves the slot empty; if the host replaced the entry, ours is
 * already gone, the slot still holds the host's implementation, and that becomes
 * the new base. Either way the wrapper delegates to a captured base, never to
 * the registry, so repeated installs cannot stack wrappers.
 *
 * Pure module: the registry is injected, so the install/re-assert logic can be
 * unit-tested without the host packages present.
 */

import { wrapApiImplementation, type ApiLayerOptions, type StreamFn } from './api-layer.ts';

/** The slice of the host api registry this module needs. */
export interface ApiRegistry {
	get(api: string): { stream: StreamFn; streamSimple: StreamFn } | undefined;
	register(api: string, implementation: { stream: StreamFn; streamSimple: StreamFn }, sourceId: string): void;
	/** Removes every entry registered under `sourceId`, if any. */
	unregister(sourceId: string): void;
}

export interface ApiInstallerOptions {
	registry: ApiRegistry;
	/** Api ids to wrap, as configured by `PI_OPENCODE_API`. */
	apis: readonly string[];
	/** Identifies our registrations in the host registry. */
	sourceId: string;
	/** Passed to every wrapper this installer creates. */
	layer: ApiLayerOptions;
	/** Receives one record per api concern, for the debug log. */
	report?: (event: Record<string, unknown>) => void;
}

/**
 * Build an idempotent `install()`. Call it while the extension factory runs and
 * again from every `session_start`: the second call is what survives the host's
 * own bootstrap.
 */
export function createApiInstaller(options: ApiInstallerOptions): () => void {
	const captured = new Map<
		string,
		{ base: { stream: StreamFn; streamSimple: StreamFn }; wrapped: { stream: StreamFn; streamSimple: StreamFn } }
	>();

	return function install(): void {
		for (const api of options.apis) {
			try {
				// Drop our own entry: if we still own it, the slot goes empty and the
				// captured base below is the one to keep using. If the host replaced it,
				// this is a no-op and the slot still shows the host's implementation.
				options.registry.unregister(options.sourceId);

				const known = captured.get(api);
				const host = options.registry.get(api);
				const base = host ?? known?.base;
				if (!base) {
					options.report?.({ layer: 'api-missing', api });
					continue;
				}
				if (typeof base.stream !== 'function' || typeof base.streamSimple !== 'function') {
					options.report?.({ layer: 'api-incomplete', api });
					continue;
				}

				// Reuse the wrapper while the base is unchanged; a replaced base (the
				// host rebuilt its own implementation) gets a fresh wrapper.
				const reused = known !== undefined && known.base === base;
				const wrapped = reused ? known.wrapped : wrapApiImplementation(base, options.layer);
				captured.set(api, { base, wrapped });
				options.registry.register(api, wrapped, options.sourceId);
				options.report?.({ layer: reused ? 'api-reinstalled' : 'api-installed', api });
			} catch (error) {
				options.report?.({
					layer: 'api-failed',
					api,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	};
}
