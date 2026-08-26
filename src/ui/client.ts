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
			try {
				const wrapped: FullscreenComponentFactory<T> = (tui, theme, keybindings, done) => {
				capture.noteTui(tui);
				return factory(tui, theme, keybindings, done);
			};
			// In the fullscreen TUI a plain custom component mounts inside the
			// bottom dock (the editor slot), where the dock layout shrinks and
			// clips it while the transcript tail renders above it. Mount it as a
			// full-screen overlay instead so the component owns the whole screen,
			// matching the regular-TUI behavior it was designed for.
			const options: CustomUiOptions | undefined = capture.isFullscreenTui()
				? {
						overlay: true,
						overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%" },
					}
				: undefined;
			return await ui.custom(wrapped, options);
			} finally {
				lease.release();
			}
		},
	};
}
