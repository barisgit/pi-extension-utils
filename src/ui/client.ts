export interface FullscreenLeaseLike {
	release(): void;
}

export interface FullscreenController {
	acquire(): FullscreenLeaseLike;
}

/**
 * Lazily-captured TUI reference used to detect the fullscreen TUI mode.
 * Populated whenever pi invokes any wrapped UI factory (widget, footer,
 * editor, custom component). Structural on purpose: the helper must not
 * depend on pi-tui types directly.
 */
export interface TuiModeCapture {
	noteTui(tui: unknown): void;
	isFullscreenTui(): boolean;
	isRegularTui(): boolean;
}

export function createTuiModeCapture(): TuiModeCapture {
	let mode: string | undefined;
	return {
		noteTui(tui: unknown): void {
			const value = (tui as { mode?: unknown } | null | undefined)?.mode;
			if (typeof value === "string") mode = value;
		},
		isFullscreenTui(): boolean {
			return mode === "fullscreen";
		},
		isRegularTui(): boolean {
			return mode === "regular";
		},
	};
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

/** Options of `ctx.ui.custom` that matter here (typed structurally). */
interface CustomUiOptions {
	overlay?: boolean;
	overlayOptions?: unknown;
}

interface CustomCapableUi {
	custom?<R>(factory: FullscreenComponentFactory<R>, options?: CustomUiOptions): Promise<R>;
}

interface LayoutRootTui {
	layoutRoot?: unknown;
	setLayoutRoot(component: unknown): void;
	requestRender?(force?: boolean): void;
}

interface ComponentLike {
	render(width: number): string[];
	invalidate?(): void;
	handleInput?(data: string): void;
	focused?: boolean;
	wantsKeyRelease?: boolean;
	dispose?(): void;
}

function getLayoutRootTui(tui: unknown): LayoutRootTui | undefined {
	if ((typeof tui !== "object" && typeof tui !== "function") || tui === null) return undefined;
	if (!("layoutRoot" in tui) || typeof (tui as LayoutRootTui).setLayoutRoot !== "function") return undefined;
	return tui as LayoutRootTui;
}

// Pi 0.84 exposes setLayoutRoot() but no getter. Its TypeScript-private
// layoutRoot remains a runtime property; keep that compatibility bridge here.
function getLayoutRoot(tui: LayoutRootTui): unknown {
	return tui.layoutRoot;
}

function createOverlayInputProxy(component: unknown): ComponentLike {
	const target = component as ComponentLike;
	const proxy: ComponentLike = {
		render: () => [],
		invalidate: () => target.invalidate?.(),
		handleInput: (data) => target.handleInput?.(data),
		get wantsKeyRelease() {
			return target.wantsKeyRelease;
		},
		dispose: () => target.dispose?.(),
	};
	if (((typeof target === "object" && target !== null) || typeof target === "function") && "focused" in target) {
		Object.defineProperty(proxy, "focused", {
			get: () => target.focused,
			set: (focused: boolean) => {
				target.focused = focused;
			},
		});
	}
	return proxy;
}

export function createUiClient(
	fullscreen: FullscreenController,
	ctx: { ui: unknown },
	capture: TuiModeCapture = createTuiModeCapture(),
): UiClient {
	return {
		async fullscreen<T>(factory: FullscreenComponentFactory<T>): Promise<T> {
			const ui = ctx.ui as CustomCapableUi;
			if (typeof ui.custom !== "function") {
				throw new Error("pi-extension-utils: ui.fullscreen requires an interactive UI (ctx.ui.custom is unavailable)");
			}
			const lease = fullscreen.acquire();
			let restoreLayoutRoot: (() => void) | undefined;
			let closed = false;
			const close = (): void => {
				closed = true;
				restoreLayoutRoot?.();
			};
			try {
				const wrapped: FullscreenComponentFactory<T> = (tui, theme, keybindings, done) => {
					capture.noteTui(tui);
					const mount = (component: unknown): unknown => {
						const layoutTui = capture.isFullscreenTui() ? getLayoutRootTui(tui) : undefined;
						if (!layoutTui) return component;
						if (closed) return createOverlayInputProxy(component);

						const priorRoot = getLayoutRoot(layoutTui);
						let restored = false;
						restoreLayoutRoot = () => {
							if (restored) return;
							restored = true;
							layoutTui.setLayoutRoot(priorRoot);
							layoutTui.requestRender?.(true);
						};
						layoutTui.setLayoutRoot(component);
						layoutTui.requestRender?.(true);
						return createOverlayInputProxy(component);
					};
					const component = factory(tui, theme, keybindings, (result) => {
						close();
						done(result);
					});
					if (component && typeof (component as PromiseLike<unknown>).then === "function") {
						return Promise.resolve(component).then(mount);
					}
					return mount(component);
				};
			// In the fullscreen TUI a plain custom component mounts inside the
			// bottom dock. Use the overlay path for focus/lifecycle, then let the
			// wrapped factory replace a capable viewport TUI's layout root. The
			// returned empty input proxy keeps the host overlay from rendering the
			// same dashboard a second time.
			// Before any wrapped factory has rendered, the mode is unknown. Default
			// that cold-start case to an overlay: it is the only mount that remains
			// safe in the alt-screen TUI. Preserve the legacy editor-slot mount only
			// when regular mode was positively seen.
			const options: CustomUiOptions | undefined = capture.isRegularTui()
				? undefined
				: {
						overlay: true,
						overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%" },
				};
				return await ui.custom(wrapped, options);
			} finally {
				try {
					close();
				} finally {
					lease.release();
				}
			}
		},
	};
}
