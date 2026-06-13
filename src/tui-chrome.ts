import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Minimal theme shape for chrome helpers: only `fg(color, text)` is required.
 * Lets the same helpers work for both `@earendil-works/pi-coding-agent` Theme and
 * any pi-tui-compatible theme.
 */
export interface ChromeTheme {
	fg(color: string, text: string): string;
	bold?(text: string): string;
}

function fuzzyScore(query: string, text: string): number {
	const lq = query.toLowerCase();
	const lt = text.toLowerCase();
	if (lt.includes(lq)) return 100 + (lq.length / lt.length) * 50;
	let score = 0;
	let qi = 0;
	let consecutive = 0;
	for (let i = 0; i < lt.length && qi < lq.length; i++) {
		if (lt[i] === lq[qi]) {
			score += 10 + consecutive;
			consecutive += 5;
			qi++;
		} else {
			consecutive = 0;
		}
	}
	return qi === lq.length ? score : 0;
}

export function fuzzyFilter<T extends { name: string; description: string; model?: string }>(items: T[], query: string): T[] {
	const q = query.trim();
	if (!q) return items;
	return items
		.map((item) => ({ item, score: Math.max(fuzzyScore(q, item.name), fuzzyScore(q, item.description) * 0.8, fuzzyScore(q, item.model ?? "") * 0.6) }))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((x) => x.item);
}

export function pad(s: string, len: number): string {
	const vis = visibleWidth(s);
	return s + " ".repeat(Math.max(0, len - vis));
}

function normalizeRenderableText(text: string): string {
	return text
		.replaceAll("\t", "    ")
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g, "");
}

export function row(content: string, width: number, theme: ChromeTheme): string {
	const innerW = Math.max(0, width - 2);
	const safeContent = truncateToWidth(normalizeRenderableText(content), innerW);
	return theme.fg("border", "│") + pad(safeContent, innerW) + theme.fg("border", "│");
}

export function renderHeader(text: string, width: number, theme: ChromeTheme): string {
	const innerW = Math.max(0, width - 2);
	const safeText = truncateToWidth(normalizeRenderableText(text), innerW);
	const padLen = Math.max(0, innerW - visibleWidth(safeText));
	const padLeft = Math.floor(padLen / 2);
	const padRight = padLen - padLeft;
	return (
		theme.fg("border", "╭" + "─".repeat(padLeft)) +
		theme.fg("accent", safeText) +
		theme.fg("border", "─".repeat(padRight) + "╮")
	);
}

export function formatPath(filePath: string): string {
	const home = process.env.HOME;
	if (home && filePath.startsWith(home)) return `~${filePath.slice(home.length)}`;
	return filePath;
}

export function formatScrollInfo(above: number, below: number, opts?: { style?: "more" | "position" }): string {
 if (opts?.style === "position") return `${above}/${below}`;
	let info = "";
	if (above > 0) info += `↑ ${above} more`;
	if (below > 0) info += `${info ? "  " : ""}↓ ${below} more`;
	return info;
}

export function renderFooter(text: string, width: number, theme: ChromeTheme): string {
	const innerW = Math.max(0, width - 2);
	const safeText = truncateToWidth(normalizeRenderableText(text), innerW);
	const padLen = Math.max(0, innerW - visibleWidth(safeText));
	const padLeft = Math.floor(padLen / 2);
	const padRight = padLen - padLeft;
	return (
		theme.fg("border", "╰" + "─".repeat(padLeft)) +
		theme.fg("dim", safeText) +
		theme.fg("border", "─".repeat(padRight) + "╯")
	);
}

export interface TitledTopSegmentOptions {
	width: number;
	label: string;
	/** Plain-text tail; styled via `tailColor` (default "dim"). */
	tail?: string;
	/** Pre-rendered tail string when caller already applied ANSI; pair with `tailPlain` for length. */
	tailRendered?: string;
	/** Plain visible-width companion for `tailRendered` so dash math stays correct. */
	tailPlain?: string;
	labelColor?: string;
	tailColor?: string;
	labelBold?: boolean;
	style?: "default" | "legacy";
}

/**
 * Build one half of a top border with an embedded title and optional right-aligned tail.
 * Layout: `─ <label> ───…─── <tail> ─` with single dashes for spacing.
 * Returns a fragment WITHOUT corner glyphs; caller composes corners + `┬` divider.
 */
export function titledTopSegment(theme: ChromeTheme, opts: TitledTopSegmentOptions): string {
	const dash = (n: number) => theme.fg("dim", "─".repeat(Math.max(0, n)));
	if (opts.style === "legacy") {
		const width = Math.max(0, opts.width);
		if (width <= 0) return "";
		if (width <= 2) return dash(width);
		const labelColor = opts.labelColor ?? "text";
		const tailColor = opts.tailColor ?? "dim";
		const tailPlain = opts.tailPlain ?? opts.tail ?? "";
		const tailRendered = opts.tailRendered ?? (opts.tail !== undefined ? theme.fg(tailColor, opts.tail) : "");
		const tailLen = visibleWidth(tailPlain);
		const canShowTail = tailLen > 0 && width - tailLen >= 14;
		const labelBudget = Math.max(0, width - (canShowTail ? tailLen + 6 : 4));
		const labelText = clipText(opts.label ?? "", labelBudget);
		const labelLen = visibleWidth(labelText);
		if (labelLen === 0) return dash(width);
		const labelStyled = opts.labelBold && theme.bold
			? theme.bold(theme.fg(labelColor, labelText))
			: theme.fg(labelColor, labelText);
		if (canShowTail) {
			const fillDashes = Math.max(1, width - labelLen - tailLen - 6);
			return clipStyled(`${dash(1)} ${labelStyled} ${dash(fillDashes)} ${tailRendered} ${dash(1)}`, width);
		}
		const fillDashes = Math.max(1, width - labelLen - 3);
		return clipStyled(`${dash(1)} ${labelStyled} ${dash(fillDashes)}`, width);
	}
	const width = Math.max(0, opts.width);
	if (width <= 0) return "";
	const labelColor = opts.labelColor ?? "text";
	const tailColor = opts.tailColor ?? "dim";
	const tailPlain = opts.tailPlain ?? opts.tail ?? "";
	const rawTailRendered = opts.tailRendered ?? (opts.tail !== undefined ? theme.fg(tailColor, opts.tail) : "");
	const tailLen = visibleWidth(tailPlain);
	// With a tail, the minimum chrome is:
	// `─ ` + label + ` ` + `─` + ` ` + tail + ` ` + `─` = label + tail + 7.
	// The previous math reserved only 6 columns, so long label+tail combinations
	// could render one column too wide and crash Pi's TUI at terminal width.
	const tailFits = tailLen > 0 && width >= tailLen + 7;
	const labelBudget = tailFits ? Math.max(0, width - tailLen - 7) : Math.max(0, width - 3);
	// Defensive: callers occasionally pass undefined labels for transient/legacy
	// runs that lack agent+mode+label; treat as empty rather than crashing pi.
	const rawLabel = opts.label ?? "";
	const labelText = truncateToWidth(rawLabel, labelBudget, "").replace(/\u001b\[[0-9;]*m/g, "");
	const labelStyled = opts.labelBold && theme.bold
		? theme.bold(theme.fg(labelColor, labelText))
		: theme.fg(labelColor, labelText);
	const labelLen = visibleWidth(labelText);
	// Layout with tail: `─ <label> ──…── <tail> ─`.
	// Layout without tail: `─ <label> ──…────`.
	if (tailFits) {
		const tailRendered = visibleWidth(rawTailRendered) > tailLen ? clipStyled(rawTailRendered, tailLen) : rawTailRendered;
		const fillDashes = Math.max(1, width - (labelLen + tailLen + 6));
		return clipStyled(`${dash(1)} ${labelStyled} ${dash(fillDashes)} ${tailRendered} ${dash(1)}`, width);
	}
	const fillDashes = Math.max(0, width - (labelLen + 3));
	return clipStyled(`${dash(1)} ${labelStyled} ${dash(fillDashes)}`, width);
}

/**
 * Build one half of a bottom border with an embedded hint string.
 * Layout: `─ <hint> ───…─` (no tail). Empty hint renders as a solid dash run.
 */
export function titledBottomSegment(theme: ChromeTheme, width: number, hint: string, focused: boolean): string {
	const dash = (n: number) => theme.fg("dim", "─".repeat(Math.max(0, n)));
	if (width <= 0) return "";
	if (!hint) return dash(width);
	// Reserve at minimum `─ ` + hint + ` `; truncate hint to fit when narrow so we never overflow.
	const hintBudget = Math.max(0, width - 3);
	const clipped = truncateToWidth(hint, hintBudget);
	const clippedLen = visibleWidth(clipped);
	if (clippedLen === 0) return dash(width);
	const hintStyled = focused && theme.bold
		? theme.bold(theme.fg("accent", clipped))
		: theme.fg("dim", clipped);
	const fillDashes = Math.max(0, width - (clippedLen + 3));
	return `${dash(1)} ${hintStyled} ${dash(fillDashes)}`;
}

/** Pad-right to a visible width using `visibleWidth` (ANSI-aware). */
export function padRight(text: string, width: number): string {
	const clipped = visibleWidth(text) > width ? clipStyled(text, width) : text;
	const pad = Math.max(0, width - visibleWidth(clipped));
	return clipped + " ".repeat(pad);
}

/** Slice text by visible width and preserve ANSI color resets when present. */
export function clipStyled(text: string, width: number): string {
	if (width <= 0) return "";
	if (!text.includes("\u001b[")) return clipText(text, width);
	return truncateToWidth(text, width, "");
}

/** Slice text by character count (NOT visible width). For label text after `clipText` we then re-measure with visibleWidth. */
export function clipText(text: string, width: number): string {
	if (width <= 0) return "";
	return Array.from(text).slice(0, width).join("");
}

/**
 * Inline horizontal rule with an embedded title, NO corner/tee glyphs.
 * Used inside a pane to subdivide sections (e.g. list / legend) without
 * faking a second box border. Layout: `─ <title> ──…──`.
 */
export function flatRule(theme: ChromeTheme, title: string, width: number, opts?: { leadingDashes?: number }): string {
	if (width <= 0) return "";
	const dash = (n: number) => theme.fg("dim", "─".repeat(Math.max(0, n)));
	if (!title) return dash(width);
	if (opts?.leadingDashes !== undefined) {
		const label = ` ${title} `;
		const labelW = visibleWidth(label);
		if (labelW + 4 >= width) return dash(width);
		const leading = Math.max(0, opts.leadingDashes);
		const trailing = Math.max(0, width - labelW - leading);
		return `${dash(leading)}${theme.fg("dim", label)}${dash(trailing)}`;
	}
	const clipped = truncateToWidth(title, Math.max(0, width - 4));
	const clippedLen = visibleWidth(clipped);
	const styled = theme.fg("dim", clipped);
	const trailing = Math.max(0, width - (clippedLen + 3));
	return `${dash(1)} ${styled} ${dash(trailing)}`;
}

/** Body row for a two-pane box. Caller supplies the left and right interior widths. */
export function boxRow(theme: ChromeTheme, left: string, right: string, leftWidth: number, rightWidth: number): string {
	const border = theme.fg("dim", "│");
	const leftCell = padRight(truncateToWidth(left, leftWidth), leftWidth);
	const rightCell = padRight(truncateToWidth(right, rightWidth), rightWidth);
	return border + leftCell + border + rightCell + border;
}

/** Aligned key legend row, dimmed by the caller when desired. */
export function renderKeyRow(key: string, desc: string, width: number, keyWidth: number): string {
	const keyCell = padRight(key, keyWidth);
	return clipStyled(`${keyCell}  ${desc}`, width);
}
