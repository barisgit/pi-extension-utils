/**
 * SGR (1006) mouse sequence parsing for pane overlays.
 *
 * In fullscreen TUI mode a focused overlay receives raw mouse input: pi's
 * alt-screen viewport handler defers wheel and SGR mouse sequences to the
 * focused component (see TuiAltScreen#shouldDeferViewportInputToOverlay).
 * These helpers turn those sequences into structured events. In regular TUI
 * mode no mouse sequences arrive, so pane overlays degrade gracefully to
 * keyboard-only input with zero changes at call sites.
 */

export interface SgrMouseEvent {
	/** 0 = left, 1 = middle, 2 = right, 64 = wheel up, 65 = wheel down. */
	button: number;
	/** 1-based terminal column. */
	x: number;
	/** 1-based terminal row. */
	y: number;
	/** Button press (not motion, not release). */
	press: boolean;
	release: boolean;
	/** Motion with a button held (drag). */
	motion: boolean;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
}

const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

/** Parse a full SGR mouse sequence. Returns undefined for any other input. */
export function parseSgrMouseEvent(data: string): SgrMouseEvent | undefined {
	const match = SGR_MOUSE_RE.exec(data);
	if (!match) return undefined;
	const cb = Number(match[1]);
	const x = Number(match[2]);
	const y = Number(match[3]);
	const isRelease = match[4] === "m";
	const motion = (cb & 32) !== 0 && !isRelease;
	const wheel = (cb & 64) !== 0;
	const buttonBits = cb & 3;
	return {
		button: wheel ? 64 + buttonBits : buttonBits,
		x,
		y,
		press: !isRelease && !motion,
		release: isRelease,
		motion,
		shift: (cb & 4) !== 0,
		alt: (cb & 8) !== 0,
		ctrl: (cb & 16) !== 0,
	};
}
