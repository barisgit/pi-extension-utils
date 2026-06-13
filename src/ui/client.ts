export interface FullscreenLeaseLike {
	release(): void;
}

export interface FullscreenController {
	acquire(): FullscreenLeaseLike;
}

/**
 * Factory signature accepted by `ctx.ui.custom`. Typed structurally so the
 * helper does not depend on pi-tui types directly.
 */
export type FullscreenComponentFactory<T> = (
	tui: unknown,
	theme: unknown,
	keybindings: unknown,
	done: (result: T) => void,
) => unknown;

export interface UiClient {
	/**
	 * Run a full-screen custom UI: acquires a fullscreen lease (blanking
	 * coordinated widgets), shows the component via `ctx.ui.custom`, and
	 * releases the lease in a finally — even if the component throws.
	 */
	fullscreen<T>(factory: FullscreenComponentFactory<T>): Promise<T>;
}

export function createUiClient(fullscreen: FullscreenController, ctx: { ui: unknown }): UiClient {
	return {
		async fullscreen<T>(factory: FullscreenComponentFactory<T>): Promise<T> {
			const ui = ctx.ui as { custom?<R>(f: FullscreenComponentFactory<R>): Promise<R> };
			if (typeof ui.custom !== "function") {
				throw new Error("pi-extension-utils: ui.fullscreen requires an interactive UI (ctx.ui.custom is unavailable)");
			}
			const lease = fullscreen.acquire();
			try {
				return await ui.custom(factory);
			} finally {
				lease.release();
			}
		},
	};
}
