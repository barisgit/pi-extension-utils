/**
 * Parse synthetic/explicit SGR input accepted by pane overlays. Pi 1.2 fullscreen
 * dispatch uses Component.handleMouse instead; consumers that synthesize wheel
 * reports can still use this adapter through handleInput.
 */

export interface SgrMouseEvent {
	/** 0 = left, 1 = middle, 2 = right, 64 = wheel up, 65 = wheel down. */
	button: number;
	/** 0-based terminal column. */
	x: number;
	/** 0-based terminal row. */
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
	const x = Number(match[2]) - 1;
	const y = Number(match[3]) - 1;
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
