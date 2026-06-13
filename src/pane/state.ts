export type PaneFocus = "left" | "right";
export type PaneDirection = -1 | 1;

export interface SplitPaneLayoutOptions {
	totalWidth: number;
	leftFraction: number;
	minLeftWidth: number;
	minRightWidth: number;
	leftMaxWidth?: number;
	separatorWidth?: number;
	minFraction?: number;
	maxFraction?: number;
	/** Use "total" for the subagents dashboard math, "interior" for picker-style split math. */
	fractionBasis?: "total" | "interior";
}

export interface SplitPaneLayout {
	leftWidth: number;
	rightWidth: number;
	interiorWidth: number;
	leftFraction: number;
}

export interface ResizeSplitPaneOptions extends SplitPaneLayoutOptions {
	direction: PaneDirection;
	stepCols: number;
}

export interface FixedSidebarLayoutOptions {
	totalWidth: number;
	collapsed: boolean;
	leftWidth: number;
	collapsedLeftWidth?: number;
	minLeftWidth?: number;
	minRightWidth?: number;
	separatorWidth?: number;
	collapsedChromeWidth?: number;
}

export interface FixedSidebarLayout {
	collapsed: boolean;
	leftWidth: number;
	rightWidth: number;
	interiorWidth: number;
}

export interface SidebarState {
	collapsed: boolean;
	focus: PaneFocus;
}

export interface ScrollViewportState {
	offset: number;
	contentLength: number;
	viewportHeight: number;
}

export interface CursorViewportState {
	cursor: number;
	scroll: number;
	itemCount: number;
	viewportHeight: number;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function togglePaneFocus(focus: PaneFocus): PaneFocus {
	return focus === "left" ? "right" : "left";
}

export function computeSplitPaneLayout(opts: SplitPaneLayoutOptions): SplitPaneLayout {
	const separatorWidth = opts.separatorWidth ?? 3;
	const interiorWidth = Math.max(0, opts.totalWidth - separatorWidth);
	const basis = opts.fractionBasis === "interior" ? interiorWidth : opts.totalWidth;
	const rawLeft = Math.round(Math.max(0, basis) * opts.leftFraction);
	const capped = Math.min(opts.leftMaxWidth ?? Number.POSITIVE_INFINITY, Math.max(0, interiorWidth - opts.minRightWidth));
	const maxLeft = capped > 0 ? capped : interiorWidth;
	const minLeft = Math.min(opts.minLeftWidth, maxLeft);
	const leftWidth = clamp(rawLeft, minLeft, maxLeft);
	return {
		leftWidth,
		rightWidth: Math.max(0, interiorWidth - leftWidth),
		interiorWidth,
		leftFraction: opts.leftFraction,
	};
}

export function resizeSplitPane(opts: ResizeSplitPaneOptions): SplitPaneLayout {
	const separatorWidth = opts.separatorWidth ?? 3;
	const interiorWidth = Math.max(1, opts.totalWidth - separatorWidth);
	const current = computeSplitPaneLayout(opts);
	const basis = opts.fractionBasis === "interior" ? interiorWidth : Math.max(1, opts.totalWidth);
	const nextFraction = opts.fractionBasis === "interior"
		? (current.leftWidth + opts.direction * opts.stepCols) / basis
		: opts.leftFraction + (opts.direction * opts.stepCols) / basis;
	const next = computeSplitPaneLayout({
		...opts,
		leftFraction: clamp(nextFraction, opts.minFraction ?? 0.2, opts.maxFraction ?? 0.7),
	});
	return next.leftWidth === current.leftWidth ? current : next;
}

export function computeFixedSidebarLayout(opts: FixedSidebarLayoutOptions): FixedSidebarLayout {
	const separatorWidth = opts.separatorWidth ?? 3;
	if (opts.collapsed) {
		const leftWidth = Math.max(0, opts.collapsedLeftWidth ?? 0);
		const chromeWidth = opts.collapsedChromeWidth ?? (leftWidth > 0 ? separatorWidth : 2);
		return {
			collapsed: true,
			leftWidth,
			rightWidth: Math.max(0, opts.totalWidth - chromeWidth - leftWidth),
			interiorWidth: Math.max(0, opts.totalWidth - chromeWidth),
		};
	}
	const interiorWidth = Math.max(0, opts.totalWidth - separatorWidth);
	const minRight = opts.minRightWidth ?? 0;
	const maxLeft = Math.max(0, interiorWidth - minRight);
	const minLeft = Math.min(opts.minLeftWidth ?? 0, maxLeft);
	const leftWidth = clamp(opts.leftWidth, minLeft, maxLeft || interiorWidth);
	return {
		collapsed: false,
		leftWidth,
		rightWidth: Math.max(0, interiorWidth - leftWidth),
		interiorWidth,
	};
}

export function toggleSidebar(state: SidebarState): SidebarState {
	const collapsed = !state.collapsed;
	return { collapsed, focus: collapsed ? "right" : state.focus };
}

export function clampScrollOffset(offset: number, contentLength: number, viewportHeight: number): number {
	const maxOffset = Math.max(0, contentLength - Math.max(0, viewportHeight));
	return clamp(offset, 0, maxOffset);
}

export function moveScrollOffset(state: ScrollViewportState, delta: number): number {
	return clampScrollOffset(state.offset + delta, state.contentLength, state.viewportHeight);
}

export function pageScrollOffset(state: ScrollViewportState, direction: PaneDirection, pageSize = state.viewportHeight): number {
	return moveScrollOffset(state, direction * Math.max(1, pageSize));
}

export function homeScrollOffset(): number {
	return 0;
}

export function endScrollOffset(contentLength: number, viewportHeight: number): number {
	return clampScrollOffset(Number.POSITIVE_INFINITY, contentLength, viewportHeight);
}

export function ensureCursorVisible(state: CursorViewportState): CursorViewportState {
	const itemCount = Math.max(0, state.itemCount);
	const viewportHeight = Math.max(1, state.viewportHeight);
	const cursor = itemCount === 0 ? 0 : clamp(state.cursor, 0, itemCount - 1);
	let scroll = clampScrollOffset(state.scroll, itemCount, viewportHeight);
	if (itemCount === 0) return { cursor, scroll: 0, itemCount, viewportHeight };
	if (cursor < scroll) scroll = cursor;
	else if (cursor >= scroll + viewportHeight) scroll = cursor - viewportHeight + 1;
	scroll = clampScrollOffset(scroll, itemCount, viewportHeight);
	return { cursor, scroll, itemCount, viewportHeight };
}

export function moveCursor(state: CursorViewportState, delta: number): CursorViewportState {
	return ensureCursorVisible({ ...state, cursor: state.cursor + delta });
}

export function pageCursor(state: CursorViewportState, direction: PaneDirection, pageSize = state.viewportHeight): CursorViewportState {
	return moveCursor(state, direction * Math.max(1, pageSize));
}

export function homeCursor(state: CursorViewportState): CursorViewportState {
	return ensureCursorVisible({ ...state, cursor: 0 });
}

export function endCursor(state: CursorViewportState): CursorViewportState {
	return ensureCursorVisible({ ...state, cursor: Math.max(0, state.itemCount - 1) });
}
