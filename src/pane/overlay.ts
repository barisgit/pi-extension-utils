import type { FullscreenComponentFactory } from "../ui/client.ts";
import { dispatchNavKeys } from "./key-dispatch.ts";
import {
	computeFixedSidebarLayout,
	computeSplitPaneLayout,
	endScrollOffset,
	ensureCursorVisible,
	homeScrollOffset,
	moveScrollOffset,
	pageScrollOffset,
	resizeSplitPane,
	type PaneDirection,
} from "./state.ts";
import {
	boxRow,
	clipStyled,
	flatRule,
	formatScrollInfo,
	padRight,
	renderKeyRow,
	titledBottomSegment,
	titledTopSegment,
	type ChromeTheme,
} from "./chrome.ts";
import { matchesKey } from "@earendil-works/pi-tui";

type MatchKey = Parameters<typeof matchesKey>[1];

export interface PaneOverlayContext<T = unknown, Row = unknown> {
	tui: unknown;
	primaryFocus: boolean;
	detailFocus: boolean;
	selectedRow: Row | undefined;
	selectedIndex: number;
	selectedKey: string;
	primary: { mode: "cursor" | "scroll"; cursor: number; scrollOffset: number; width: number };
	detail: { scrollOffset: number; width: number };
	close(result?: T): void;
	requestRender(): void;
}

export interface PaneOverlaySeparatorRow {
	kind: "separator";
	label?: string;
}

export type PaneOverlayPrimaryRow<Row = unknown> = Row | PaneOverlaySeparatorRow;

export interface PaneOverlayTitle {
	label: string;
	tail?: string;
	tailRendered?: string;
	tailPlain?: string;
	labelColor?: string;
	tailColor?: string;
	labelBold?: boolean;
}

type PaneOverlayTitleValue<Row> = string | PaneOverlayTitle | ((ctx: PaneOverlayContext<unknown, Row>) => string | PaneOverlayTitle);

export interface PaneOverlayCustomAction<T = unknown, Row = unknown> {
	keys: string | readonly string[];
	label: string;
	run(ctx: PaneOverlayContext<T, Row>): void;
	when?(ctx: PaneOverlayContext<T, Row>): boolean;
	showInLegend?: boolean;
}

export interface PrimaryPaneOptions<Row = unknown> {
	mode?: "cursor" | "scroll";
	rows: PaneOverlayPrimaryRow<Row>[] | ((ctx: PaneOverlayContext<unknown, Row>) => PaneOverlayPrimaryRow<Row>[]);
	renderRow?(row: Row, ctx: PaneOverlayContext<unknown, Row>, width: number): string;
	selectionKey?(row: Row, index: number): string;
	initialSelectionKey?: string;
	initialIndex?: number;
	onSelectionChange?(row: Row | undefined, index: number, key: string, ctx: PaneOverlayContext<unknown, Row>): void;
	title?: PaneOverlayTitleValue<Row>;
	info?: string[] | ((ctx: PaneOverlayContext<unknown, Row>) => string[]);
	infoTitle?: string | ((ctx: PaneOverlayContext<unknown, Row>) => string);
	footer?: string | ((ctx: PaneOverlayContext<unknown, Row>) => string);
}

export interface DetailPaneOptions<Row = unknown> {
	rows(ctx: PaneOverlayContext<unknown, Row>): string[];
	title?: PaneOverlayTitleValue<Row>;
	footer?: string | ((ctx: PaneOverlayContext<unknown, Row>) => string);
}

export interface PaneOverlaySplitOptions {
	initialFraction?: number;
	minPrimaryWidth?: number;
	minDetailWidth?: number;
	maxPrimaryWidth?: number;
	stepCols?: number;
	minFraction?: number;
	maxFraction?: number;
	fractionBasis?: "total" | "interior";
}

export interface PaneCollapseOptions {
	key?: string;
	collapsedWidth?: number;
	/**
	 * Legend/divider label for the collapse toggle. A function receives the
	 * current collapsed state so the hint can read e.g. "hide sidebar" when open
	 * and "open sidebar" when collapsed.
	 */
	label?: string | ((collapsed: boolean) => string);
}

export interface PaneOverlayOptions<T = unknown, Row = unknown> {
	primary: PrimaryPaneOptions<Row>;
	detail: DetailPaneOptions<Row>;
	height?: number | ((tui: unknown) => number);
	closeKeys?: readonly string[];
	closeResult?: T;
	customActions?: readonly PaneOverlayCustomAction<T, Row>[];
	bannedKeys?: readonly string[];
	split?: PaneOverlaySplitOptions;
	legendPlacement?: "footer" | "primary";
	collapse?: PaneCollapseOptions;
	perSelectionScroll?: boolean;
	stickyBottom?: boolean;
	onRender?(ctx: PaneOverlayContext<T, Row>): void;
}

export interface PaneOverlayComponent {
	render(width: number): string[];
	handleInput(data: string): void;
	dispose(): void;
}

const DEFAULT_CLOSE_KEYS = ["escape", "ctrl+c", "q"] as const;

function resolveValue<T, Row>(value: T | ((ctx: PaneOverlayContext<unknown, Row>) => T) | undefined, ctx: PaneOverlayContext<unknown, Row>): T | undefined {
	return typeof value === "function" ? (value as (ctx: PaneOverlayContext<unknown, Row>) => T)(ctx) : value;
}

function computeBodyHeight(tui: unknown, height: PaneOverlayOptions<unknown, unknown>["height"]): number {
	if (typeof height === "number") return Math.max(1, height);
	if (typeof height === "function") return Math.max(1, height(tui));
	const rows = (tui as { terminal?: { rows?: number } } | null)?.terminal?.rows;
	if (typeof rows === "number") return Math.max(8, rows - 2);
	return 16;
}

function matchesAny(data: string, binding: string | readonly string[] | undefined): boolean {
	if (!binding) return false;
	const keys = typeof binding === "string" ? [binding] : binding;
	return keys.some((key) => data === key || matchesKey(data, key as MatchKey));
}

function defaultRenderRow<Row>(row: Row): string {
	return typeof row === "string" ? row : String(row);
}

function decorateRow(text: string, theme: ChromeTheme): string {
	return theme.bold ? theme.bold(theme.fg("accent", text)) : theme.fg("accent", text);
}

function isSeparatorRow<Row>(row: PaneOverlayPrimaryRow<Row> | undefined): row is PaneOverlaySeparatorRow {
	return typeof row === "object" && row !== null && (row as { kind?: unknown }).kind === "separator";
}

function selectableIndexes<Row>(rows: readonly PaneOverlayPrimaryRow<Row>[]): number[] {
	const indexes: number[] = [];
	for (let index = 0; index < rows.length; index++) {
		if (!isSeparatorRow(rows[index])) indexes.push(index);
	}
	return indexes;
}

function nearestSelectableIndex<Row>(rows: readonly PaneOverlayPrimaryRow<Row>[], start: number): number {
	if (rows.length === 0) return 0;
	const clamped = Math.max(0, Math.min(start, rows.length - 1));
	if (!isSeparatorRow(rows[clamped])) return clamped;
	for (let offset = 1; offset < rows.length; offset++) {
		const after = clamped + offset;
		if (after < rows.length && !isSeparatorRow(rows[after])) return after;
		const before = clamped - offset;
		if (before >= 0 && !isSeparatorRow(rows[before])) return before;
	}
	return 0;
}

function titleOptions<Row>(
	title: string | PaneOverlayTitle | undefined,
	focused: boolean,
): Omit<Parameters<typeof titledTopSegment>[1], "width"> {
	if (typeof title === "object" && title !== null) {
		return {
			label: title.label,
			tail: title.tail,
			tailRendered: title.tailRendered,
			tailPlain: title.tailPlain,
			labelColor: title.labelColor ?? (focused ? "accent" : "text"),
			tailColor: title.tailColor,
			labelBold: title.labelBold ?? focused,
		};
	}
	return {
		label: title ?? "",
		labelColor: focused ? "accent" : "text",
		labelBold: focused,
	};
}

export function paneOverlay<T = undefined, Row = unknown>(
	options: PaneOverlayOptions<T, Row>,
): FullscreenComponentFactory<T> {
	const split = options.split ?? {};
	const closeKeys = options.closeKeys ?? DEFAULT_CLOSE_KEYS;
	const customActions = options.customActions ?? [];
	const bannedKeys = options.bannedKeys ?? [];
	const legendPlacement = options.legendPlacement ?? "footer";
	const perSelectionScroll = options.perSelectionScroll ?? false;
	const stickyBottom = options.stickyBottom ?? false;
	const collapse = options.collapse;
	const collapseKey = collapse?.key ?? "c";
	const collapsedWidth = collapse?.collapsedWidth ?? 1;

	return (tui, theme, _keybindings, done) => {
		const chromeTheme = theme as ChromeTheme;
		let finished = false;
		let focus: "primary" | "detail" = "primary";
		let collapsed = false;
		const collapseLabel = (fallback: string): string => {
			const label = collapse?.label;
			return typeof label === "function" ? label(collapsed) : (label ?? fallback);
		};
		let leftFraction = split.initialFraction ?? 0.5;
		let lastRenderWidth = 80;
		let lastSelectedKey: string | undefined;
		let initialSelectionApplied = false;

		const primaryState = { cursor: 0, scrollOffset: 0 };
		const detailState = { scrollOffset: 0, sticky: stickyBottom };
		const perSelectionOffsets = new Map<string, { offset: number; sticky: boolean }>();

		const requestRender = () => {
			(tui as { requestRender?(): void } | null)?.requestRender?.();
		};

		const finish = (result: T) => {
			if (finished) return;
			finished = true;
			done(result);
		};

		const makeContext = (
			selectedIndex: number,
			selectedRow: Row | undefined,
			selectedKey: string,
			primaryWidth = 0,
			detailWidth = 0,
		): PaneOverlayContext<T, Row> => ({
			tui,
			primaryFocus: focus === "primary",
			detailFocus: focus === "detail",
			selectedRow,
			selectedIndex,
			selectedKey,
			primary: {
				mode: options.primary.mode ?? "scroll",
				cursor: primaryState.cursor,
				scrollOffset: primaryState.scrollOffset,
				width: primaryWidth,
			},
			detail: { scrollOffset: detailState.scrollOffset, width: detailWidth },
			close: (result) => finish(result as T),
			requestRender,
		});

		const getLayout = (totalWidth: number) => {
			if (collapsed) {
				return computeFixedSidebarLayout({
					totalWidth,
					collapsed: true,
					leftWidth: collapsedWidth,
					collapsedLeftWidth: collapsedWidth,
					minLeftWidth: split.minPrimaryWidth ?? 0,
					minRightWidth: split.minDetailWidth ?? 8,
				});
			}
			return computeSplitPaneLayout({
				totalWidth,
				leftFraction,
				minLeftWidth: split.minPrimaryWidth ?? 8,
				minRightWidth: split.minDetailWidth ?? 8,
				leftMaxWidth: split.maxPrimaryWidth,
				minFraction: split.minFraction,
				maxFraction: split.maxFraction,
				fractionBasis: split.fractionBasis,
			});
		};

		const currentWidths = () => {
			const layout = getLayout(lastRenderWidth);
			return { primaryWidth: layout.leftWidth, detailWidth: layout.rightWidth };
		};

		const getPrimaryRows = (ctx: PaneOverlayContext<T, Row>): PaneOverlayPrimaryRow<Row>[] => {
			return resolveValue(options.primary.rows, ctx) ?? [];
		};

		const selectionKeyFor = (row: Row, index: number) => {
			return (options.primary.selectionKey ?? ((_row, rowIndex) => String(rowIndex)))(row, index);
		};

		const applyInitialSelection = (rows: PaneOverlayPrimaryRow<Row>[]) => {
			if (initialSelectionApplied || rows.length === 0) return;
			let targetIndex = -1;
			if (options.primary.initialSelectionKey !== undefined) {
				targetIndex = rows.findIndex((row, index) => !isSeparatorRow(row) && selectionKeyFor(row, index) === options.primary.initialSelectionKey);
			}
			if (targetIndex < 0 && options.primary.initialIndex !== undefined) {
				targetIndex = options.primary.initialIndex;
			}
			if (targetIndex < 0) return;
			initialSelectionApplied = true;
			const selectableIndex = nearestSelectableIndex(rows, targetIndex);
			primaryState.cursor = selectableIndex;
			primaryState.scrollOffset = selectableIndex;
		};

		const computeSelectionFromRows = (primaryRows: PaneOverlayPrimaryRow<Row>[], bodyHeight: number) => {
			applyInitialSelection(primaryRows);
			const primaryMode = options.primary.mode ?? "scroll";
			let selectedIndex = 0;
			if (primaryMode === "cursor") {
				const viewport = ensureCursorVisible({
					cursor: nearestSelectableIndex(primaryRows, primaryState.cursor),
					scroll: primaryState.scrollOffset,
					itemCount: primaryRows.length,
					viewportHeight: Math.max(1, bodyHeight),
				});
				primaryState.cursor = nearestSelectableIndex(primaryRows, viewport.cursor);
				primaryState.scrollOffset = viewport.scroll;
				selectedIndex = primaryState.cursor;
			} else {
				primaryState.scrollOffset = Math.min(primaryState.scrollOffset, Math.max(0, primaryRows.length - 1));
				selectedIndex = nearestSelectableIndex(primaryRows, primaryState.scrollOffset);
				primaryState.scrollOffset = selectedIndex;
			}
			if (primaryRows.length === 0 || selectableIndexes(primaryRows).length === 0) selectedIndex = 0;
			const selectedCandidate = primaryRows[selectedIndex];
			const selectedRow = !isSeparatorRow(selectedCandidate) ? selectedCandidate : undefined;
			const selectedKey = selectedRow !== undefined ? selectionKeyFor(selectedRow, selectedIndex) : String(selectedIndex);
			return { primaryRows, selectedIndex, selectedRow, selectedKey };
		};

		const resize = (direction: PaneDirection) => {
			if (collapsed) return;
			const next = resizeSplitPane({
				totalWidth: lastRenderWidth,
				leftFraction,
				direction,
				stepCols: split.stepCols ?? 4,
				minLeftWidth: split.minPrimaryWidth ?? 8,
				minRightWidth: split.minDetailWidth ?? 8,
				leftMaxWidth: split.maxPrimaryWidth,
				minFraction: split.minFraction,
				maxFraction: split.maxFraction,
				fractionBasis: split.fractionBasis,
			});
			leftFraction = next.leftFraction;
		};

		const toggleFocus = () => {
			focus = focus === "primary" ? "detail" : "primary";
		};

		const ensureFocusDetailWhenCollapsed = () => {
			if (collapsed) focus = "detail";
		};

		const getDetailStateForKey = (key: string) => {
			let state = perSelectionOffsets.get(key);
			if (!state) {
				state = { offset: 0, sticky: stickyBottom };
				perSelectionOffsets.set(key, state);
			}
			return state;
		};

		const primarySections = (bodyHeight: number, legendLineCount: number, infoLineCount: number) => {
			const legendBlockHeight = legendPlacement === "primary" && legendLineCount > 0 ? legendLineCount + 1 : 0;
			const availableBeforeLegend = Math.max(0, bodyHeight - legendBlockHeight);
			const infoVisibleCount = infoLineCount > 0
				? Math.min(infoLineCount, Math.max(0, availableBeforeLegend - 2))
				: 0;
			const infoBlockHeight = infoVisibleCount > 0 ? infoVisibleCount + 1 : 0;
			return {
				primaryHeight: Math.max(0, availableBeforeLegend - infoBlockHeight),
				detailHeight: bodyHeight,
				infoVisibleCount,
			};
		};

		const pageSizeHalf = (height: number) => Math.max(1, Math.floor(height / 2));

		const withPrimaryViewport = (bodyHeight: number, legendLineCount: number) => {
			const { primaryWidth, detailWidth } = currentWidths();
			const primaryRows = getPrimaryRows(makeContext(0, undefined, "", primaryWidth, detailWidth));
			const selection = computeSelectionFromRows(primaryRows, bodyHeight);
			const ctx = makeContext(selection.selectedIndex, selection.selectedRow, selection.selectedKey, primaryWidth, detailWidth);
			const infoLines = resolveValue(options.primary.info, ctx) ?? [];
			const viewportHeight = primarySections(bodyHeight, legendLineCount, infoLines.length).primaryHeight;
			return { primaryRows, viewportHeight: Math.max(1, viewportHeight) };
		};

		const applyPrimaryNav = (
			bodyHeight: number,
			legendLineCount: number,
			mutator: (state: typeof primaryState, rows: PaneOverlayPrimaryRow<Row>[], viewportHeight: number) => void,
		) => {
			const { primaryRows, viewportHeight } = withPrimaryViewport(bodyHeight, legendLineCount);
			mutator(primaryState, primaryRows, viewportHeight);
		};

		const movePrimary = (delta: PaneDirection, bodyHeight: number, legendLineCount: number) => {
			applyPrimaryNav(bodyHeight, legendLineCount, (state, rows, viewportHeight) => {
				if ((options.primary.mode ?? "scroll") === "cursor") {
					const indexes = selectableIndexes(rows);
					if (indexes.length === 0) return;
					const currentIndex = nearestSelectableIndex(rows, state.cursor);
					const currentOrdinal = Math.max(0, indexes.indexOf(currentIndex));
					state.cursor = indexes[Math.max(0, Math.min(indexes.length - 1, currentOrdinal + delta))] ?? currentIndex;
					const next = ensureCursorVisible({ cursor: state.cursor, scroll: state.scrollOffset, itemCount: rows.length, viewportHeight });
					state.scrollOffset = next.scroll;
				} else {
					state.scrollOffset = moveScrollOffset({ offset: state.scrollOffset, contentLength: rows.length, viewportHeight }, delta);
				}
			});
		};

		const halfPagePrimary = (delta: PaneDirection, bodyHeight: number, legendLineCount: number) => {
			applyPrimaryNav(bodyHeight, legendLineCount, (state, rows, viewportHeight) => {
				const pageSize = pageSizeHalf(viewportHeight);
				if ((options.primary.mode ?? "scroll") === "cursor") {
					const indexes = selectableIndexes(rows);
					if (indexes.length === 0) return;
					const currentIndex = nearestSelectableIndex(rows, state.cursor);
					const currentOrdinal = Math.max(0, indexes.indexOf(currentIndex));
					state.cursor = indexes[Math.max(0, Math.min(indexes.length - 1, currentOrdinal + delta * pageSize))] ?? currentIndex;
					const next = ensureCursorVisible({ cursor: state.cursor, scroll: state.scrollOffset, itemCount: rows.length, viewportHeight });
					state.scrollOffset = next.scroll;
				} else {
					state.scrollOffset = pageScrollOffset({ offset: state.scrollOffset, contentLength: rows.length, viewportHeight }, delta, pageSize);
				}
			});
		};

		const homePrimary = (bodyHeight: number, legendLineCount: number) => {
			applyPrimaryNav(bodyHeight, legendLineCount, (state, rows, viewportHeight) => {
				if ((options.primary.mode ?? "scroll") === "cursor") {
					const indexes = selectableIndexes(rows);
					if (indexes.length === 0) return;
					const next = ensureCursorVisible({ cursor: indexes[0] ?? 0, scroll: state.scrollOffset, itemCount: rows.length, viewportHeight });
					state.cursor = next.cursor;
					state.scrollOffset = next.scroll;
				} else {
					state.scrollOffset = homeScrollOffset();
				}
			});
		};

		const endPrimary = (bodyHeight: number, legendLineCount: number) => {
			applyPrimaryNav(bodyHeight, legendLineCount, (state, rows, viewportHeight) => {
				if ((options.primary.mode ?? "scroll") === "cursor") {
					const indexes = selectableIndexes(rows);
					if (indexes.length === 0) return;
					const next = ensureCursorVisible({ cursor: indexes[indexes.length - 1] ?? 0, scroll: state.scrollOffset, itemCount: rows.length, viewportHeight });
					state.cursor = next.cursor;
					state.scrollOffset = next.scroll;
				} else {
					state.scrollOffset = endScrollOffset(rows.length, viewportHeight);
				}
			});
		};

		const markDetailManual = () => {
			detailState.sticky = false;
			if (perSelectionScroll && lastSelectedKey !== undefined) {
				getDetailStateForKey(lastSelectedKey).sticky = false;
			}
		};

		const legendEntries = (ctx: PaneOverlayContext<T, Row>): { key: string; label: string }[] => {
			const entries: { key: string; label: string }[] = [];
			entries.push({ key: "tab/←/→", label: "focus" });
			const primaryMode = options.primary.mode ?? "scroll";
			const moveLabel = ctx.detailFocus || primaryMode === "scroll" ? "scroll" : "select";
			entries.push({ key: "j/k", label: moveLabel });
			entries.push({ key: "u/d", label: "half-page" });
			entries.push({ key: "g/G", label: "top/bottom" });
			if (!collapsed) entries.push({ key: "[/]", label: "resize" });
			if (collapse) entries.push({ key: collapseKey, label: collapseLabel("collapse") });
			for (const action of customActions) {
				if (action.showInLegend === false) continue;
				if (action.when && !action.when(ctx)) continue;
				entries.push({ key: typeof action.keys === "string" ? action.keys : action.keys.join("/"), label: action.label });
			}
			const qCloses = closeKeys.includes("q");
			entries.push({ key: qCloses ? "q/esc" : "esc", label: "close" });
			return entries;
		};

		const renderLegendLines = (entries: { key: string; label: string }[], totalWidth: number): string[] => {
			if (entries.length === 0 || totalWidth <= 0) return [];
			const keyWidth = Math.min(11, Math.max(3, Math.floor(totalWidth / 4)));
			return entries.map((entry) => chromeTheme.fg("dim", renderKeyRow(entry.key, entry.label, totalWidth, keyWidth)));
		};

		const component: PaneOverlayComponent = {
			dispose() {
				// no-op is acceptable
			},

			render(width: number): string[] {
				const totalWidth = Math.max(10, Math.floor(width));
				lastRenderWidth = totalWidth;
				const bodyHeight = computeBodyHeight(tui, options.height);
				const layout = getLayout(totalWidth);
				const primaryWidth = layout.leftWidth;
				const detailWidth = layout.rightWidth;

				const primaryRows = getPrimaryRows(makeContext(0, undefined, "", primaryWidth, detailWidth));
				const { selectedIndex, selectedRow, selectedKey } = computeSelectionFromRows(primaryRows, bodyHeight);
				const ctx = makeContext(selectedIndex, selectedRow, selectedKey, primaryWidth, detailWidth);
				options.onRender?.(ctx);
				const detailRows = options.detail.rows(ctx) ?? [];

				if (selectedKey !== lastSelectedKey) {
					lastSelectedKey = selectedKey;
					if (options.primary.onSelectionChange) {
						options.primary.onSelectionChange(selectedRow, selectedIndex, selectedKey, ctx);
					}
					if (perSelectionScroll) {
						const state = getDetailStateForKey(selectedKey);
						detailState.scrollOffset = state.offset;
						detailState.sticky = state.sticky;
					} else if (stickyBottom) {
						detailState.sticky = true;
					}
				}

				ensureFocusDetailWhenCollapsed();

				const entries = legendEntries(ctx);
				const legendLines = renderLegendLines(entries, totalWidth);
				const infoLines = resolveValue(options.primary.info, ctx) ?? [];
				const infoTitle = resolveValue(options.primary.infoTitle, ctx) ?? "info";
				const { primaryHeight, detailHeight, infoVisibleCount } = primarySections(bodyHeight, legendLines.length, infoLines.length);

				// Align primary viewport.
				if ((options.primary.mode ?? "scroll") === "cursor") {
					const viewport = ensureCursorVisible({
						cursor: primaryState.cursor,
						scroll: primaryState.scrollOffset,
						itemCount: primaryRows.length,
						viewportHeight: Math.max(1, primaryHeight),
					});
					primaryState.cursor = viewport.cursor;
					primaryState.scrollOffset = viewport.scroll;
				} else {
					primaryState.scrollOffset = Math.max(
						0,
						Math.min(primaryState.scrollOffset, Math.max(0, primaryRows.length - primaryHeight)),
					);
				}

				// Align detail viewport.
				const detailMaxOffset = Math.max(0, detailRows.length - detailHeight);
				if (stickyBottom && detailState.sticky) {
					detailState.scrollOffset = detailMaxOffset;
				} else {
					detailState.scrollOffset = Math.max(0, Math.min(detailState.scrollOffset, detailMaxOffset));
				}
				if (perSelectionScroll) {
					const state = getDetailStateForKey(selectedKey);
					state.offset = detailState.scrollOffset;
					state.sticky = detailState.sticky;
				}

				const primaryTitle = resolveValue(options.primary.title, ctx);
				const detailTitle = resolveValue(options.detail.title, ctx);

				const topPrimary = titledTopSegment(chromeTheme, {
					width: primaryWidth,
					...titleOptions(primaryTitle, focus === "primary"),
				});
				const topDetail = titledTopSegment(chromeTheme, {
					width: detailWidth,
					...titleOptions(detailTitle, focus === "detail"),
				});

				const corner = (glyph: string) => chromeTheme.fg("dim", glyph);
				const topBorder = primaryWidth === 0
					? corner("╭") + topDetail + corner("╮")
					: corner("╭") + topPrimary + corner("┬") + topDetail + corner("╮");

				const renderFn = options.primary.renderRow ?? defaultRenderRow;
				const primaryVisible = primaryRows
					.slice(primaryState.scrollOffset, primaryState.scrollOffset + primaryHeight)
					.map((row, index) => {
						const absoluteIndex = primaryState.scrollOffset + index;
						if (isSeparatorRow(row)) return flatRule(chromeTheme, row.label ?? "", primaryWidth);
						const text = renderFn(row, ctx, primaryWidth);
						const selected = (options.primary.mode ?? "scroll") === "cursor" && absoluteIndex === primaryState.cursor && focus === "primary";
						return selected ? decorateRow(text, chromeTheme) : text;
					});

				const detailVisible = detailRows.slice(detailState.scrollOffset, detailState.scrollOffset + detailHeight);

				const selectable = selectableIndexes(primaryRows);
				const primaryFooterText = resolveValue(options.primary.footer, ctx)
					?? ((options.primary.mode ?? "scroll") === "cursor" && selectable.length > 0
						? `${Math.max(0, selectable.indexOf(primaryState.cursor)) + 1}/${selectable.length}`
						: primaryRows.length > primaryHeight
							? formatScrollInfo(primaryState.scrollOffset, Math.max(0, primaryRows.length - primaryHeight), { style: "position" })
							: "");
				const detailFooterBase =
					resolveValue(options.detail.footer, ctx) ??
					(detailRows.length > detailHeight
						? formatScrollInfo(detailState.scrollOffset, Math.max(0, detailRows.length - detailHeight), { style: "position" })
						: "");
				// When the primary pane is collapsed its legend (and the collapse hint with
				// it) disappears, so the user can't see how to reopen it. Surface the
				// reopen hint in the always-visible detail footer instead.
				const detailFooterText =
					collapsed && collapse
						? [`${collapseKey} ${collapseLabel("expand")}`, detailFooterBase].filter(Boolean).join(" \u00b7 ")
						: detailFooterBase;

				const bottomPrimary = titledBottomSegment(chromeTheme, primaryWidth, primaryFooterText, focus === "primary");
				const bottomDetail = titledBottomSegment(chromeTheme, detailWidth, detailFooterText, focus === "detail");
				const bottomBorder = primaryWidth === 0
					? corner("╰") + bottomDetail + corner("╯")
					: corner("╰") + bottomPrimary + corner("┴") + bottomDetail + corner("╯");

				const bodyLines: string[] = [];
				const infoStart = primaryHeight;
				const legendStart = primaryHeight + (infoVisibleCount > 0 ? infoVisibleCount + 1 : 0);
				for (let row = 0; row < bodyHeight; row++) {
					let primaryCell = primaryVisible[row] ?? "";
					if (infoVisibleCount > 0 && row === infoStart) {
						primaryCell = flatRule(chromeTheme, infoTitle, primaryWidth);
					} else if (infoVisibleCount > 0 && row > infoStart && row < legendStart) {
						primaryCell = infoLines[row - infoStart - 1] ?? "";
					} else if (legendPlacement === "primary" && row === legendStart && legendLines.length > 0) {
						primaryCell = flatRule(chromeTheme, collapse ? collapseLabel("actions") : "actions", primaryWidth);
					}
					if (legendPlacement === "primary" && row > legendStart) {
						const legendIndex = row - legendStart - 1;
						primaryCell = legendIndex < legendLines.length ? padRight(legendLines[legendIndex], primaryWidth) : "";
					}
					const detailCell = detailVisible[row] ?? "";
					if (primaryWidth === 0) {
						const border = chromeTheme.fg("dim", "│");
						bodyLines.push(border + padRight(clipStyled(detailCell, detailWidth), detailWidth) + border);
					} else {
						bodyLines.push(boxRow(chromeTheme, primaryCell, detailCell, primaryWidth, detailWidth));
					}
				}

				const lines = [topBorder, ...bodyLines, bottomBorder];
				if (legendPlacement === "footer") {
					lines.push(...legendLines);
				}

				return lines.map((line) => padRight(line, totalWidth));
			},

			handleInput(data: string): void {
				if (finished) return;
				const bodyHeight = computeBodyHeight(tui, options.height);

				if (matchesAny(data, closeKeys)) {
					finish(options.closeResult as T);
					return;
				}

				const { primaryWidth, detailWidth } = currentWidths();
				const primaryRows = getPrimaryRows(makeContext(0, undefined, "", primaryWidth, detailWidth));
				const { selectedIndex, selectedRow, selectedKey } = computeSelectionFromRows(primaryRows, bodyHeight);
				const ctx = makeContext(selectedIndex, selectedRow, selectedKey, primaryWidth, detailWidth);
				const detailRows = options.detail.rows(ctx) ?? [];

				for (const action of customActions) {
					if (action.when && !action.when(ctx)) continue;
					if (matchesAny(data, action.keys)) {
						action.run(ctx);
						requestRender();
						return;
					}
				}

				if (matchesAny(data, bannedKeys)) {
					requestRender();
					return;
				}

				if (matchesAny(data, ["left", "right", "tab"])) {
					toggleFocus();
					ensureFocusDetailWhenCollapsed();
					requestRender();
					return;
				}

				const legendLineCount = legendPlacement === "primary" ? renderLegendLines(legendEntries(ctx), lastRenderWidth).length : 0;

				if (matchesAny(data, ["pageUp", "pageDown"])) return;

				const commonConsumed = dispatchNavKeys(data, {
					close: () => undefined,
					closeKeys: [],
					move: (delta) => {
						if (focus === "primary") {
							movePrimary(delta as PaneDirection, bodyHeight, legendLineCount);
						} else {
							markDetailManual();
							detailState.scrollOffset = moveScrollOffset(
								{ offset: detailState.scrollOffset, contentLength: detailRows.length, viewportHeight: Math.max(1, bodyHeight) },
								delta as PaneDirection,
							);
						}
					},
					home: () => {
						if (focus === "primary") {
							homePrimary(bodyHeight, legendLineCount);
						} else {
							markDetailManual();
							detailState.scrollOffset = homeScrollOffset();
						}
					},
					end: () => {
						if (focus === "primary") {
							endPrimary(bodyHeight, legendLineCount);
						} else {
							markDetailManual();
							detailState.scrollOffset = endScrollOffset(detailRows.length, Math.max(1, bodyHeight));
						}
					},
				});
				if (commonConsumed) {
					requestRender();
					return;
				}

				if (matchesAny(data, ["u", "U"])) {
					if (focus === "primary") {
						halfPagePrimary(-1, bodyHeight, legendLineCount);
					} else {
						markDetailManual();
						detailState.scrollOffset = pageScrollOffset(
							{ offset: detailState.scrollOffset, contentLength: detailRows.length, viewportHeight: Math.max(1, bodyHeight) },
							-1,
							pageSizeHalf(bodyHeight),
						);
					}
					requestRender();
					return;
				}
				if (matchesAny(data, ["d", "D"])) {
					if (focus === "primary") {
						halfPagePrimary(1, bodyHeight, legendLineCount);
					} else {
						markDetailManual();
						detailState.scrollOffset = pageScrollOffset(
							{ offset: detailState.scrollOffset, contentLength: detailRows.length, viewportHeight: Math.max(1, bodyHeight) },
							1,
							pageSizeHalf(bodyHeight),
						);
					}
					requestRender();
					return;
				}


				if (collapse && matchesAny(data, [collapseKey])) {
					collapsed = !collapsed;
					ensureFocusDetailWhenCollapsed();
					requestRender();
					return;
				}

				if (!collapsed && matchesAny(data, ["["])) {
					resize(-1);
					requestRender();
					return;
				}
				if (!collapsed && matchesAny(data, ["]"])) {
					resize(1);
					requestRender();
					return;
				}
			},
		};

		return component;
	};
}
