import type { FullscreenComponentFactory } from "./client.ts";
import { dispatchNavKeys } from "./key-dispatch.ts";
import {
	computeFixedSidebarLayout,
	computeSplitPaneLayout,
	endCursor,
	endScrollOffset,
	ensureCursorVisible,
	homeCursor,
	homeScrollOffset,
	moveCursor,
	moveScrollOffset,
	pageCursor,
	pageScrollOffset,
	resizeSplitPane,
	type PaneDirection,
} from "./pane-state.ts";
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
} from "./tui-chrome.ts";
import { matchesKey } from "@earendil-works/pi-tui";

type MatchKey = Parameters<typeof matchesKey>[1];

export interface PaneOverlayContext<T = unknown, Row = unknown> {
	tui: unknown;
	primaryFocus: boolean;
	detailFocus: boolean;
	selectedRow: Row | undefined;
	selectedIndex: number;
	selectedKey: string;
	primary: { mode: "cursor" | "scroll"; cursor: number; scrollOffset: number };
	detail: { scrollOffset: number };
	close(result?: T): void;
	requestRender(): void;
}

export interface PaneOverlayCustomAction<T = unknown, Row = unknown> {
	keys: string | readonly string[];
	label: string;
	run(ctx: PaneOverlayContext<T, Row>): void;
	when?(ctx: PaneOverlayContext<T, Row>): boolean;
	showInLegend?: boolean;
}

export interface PrimaryPaneOptions<Row = unknown> {
	mode?: "cursor" | "scroll";
	rows: Row[] | ((ctx: PaneOverlayContext<unknown, Row>) => Row[]);
	renderRow?(row: Row, ctx: PaneOverlayContext<unknown, Row>): string;
	selectionKey?(row: Row, index: number): string;
	onSelectionChange?(row: Row | undefined, index: number, key: string, ctx: PaneOverlayContext<unknown, Row>): void;
	title?: string | ((ctx: PaneOverlayContext<unknown, Row>) => string);
	footer?: string | ((ctx: PaneOverlayContext<unknown, Row>) => string);
}

export interface DetailPaneOptions<Row = unknown> {
	rows(ctx: PaneOverlayContext<unknown, Row>): string[];
	title?: string | ((ctx: PaneOverlayContext<unknown, Row>) => string);
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
	label?: string;
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
}

export interface PaneOverlayComponent {
	render(width: number): string[];
	handleInput(data: string): void;
	dispose(): void;
}

const DEFAULT_CLOSE_KEYS = ["escape", "ctrl+c", "q"] as const;

function resolveValue<T, Row>(value: T | ((ctx: PaneOverlayContext<unknown, Row>) => T), ctx: PaneOverlayContext<unknown, Row>): T {
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
		let leftFraction = split.initialFraction ?? 0.5;
		let lastRenderWidth = 80;
		let lastSelectedKey: string | undefined;

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
			primaryRows: Row[],
			detailRows: string[],
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
			},
			detail: { scrollOffset: detailState.scrollOffset },
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

		const listViewport = (bodyHeight: number, legendLineCount: number) => {
			const primaryHeight = legendPlacement === "primary"
				? Math.max(0, bodyHeight - legendLineCount - 1)
				: bodyHeight;
			return { primaryHeight, detailHeight: bodyHeight };
		};

		const pageSizeHalf = (height: number) => Math.max(1, Math.floor(height / 2));

		const withPrimaryViewport = (bodyHeight: number, legendLineCount: number) => {
			const primaryRows = resolveValue(options.primary.rows, makeContext(0, undefined, "", [], []));
			const viewportHeight = listViewport(bodyHeight, legendLineCount).primaryHeight;
			return { primaryRows, viewportHeight: Math.max(1, viewportHeight) };
		};

		const applyPrimaryNav = (
			bodyHeight: number,
			legendLineCount: number,
			mutator: (state: typeof primaryState, rows: Row[], viewportHeight: number) => void,
		) => {
			const { primaryRows, viewportHeight } = withPrimaryViewport(bodyHeight, legendLineCount);
			mutator(primaryState, primaryRows, viewportHeight);
		};

		const movePrimary = (delta: PaneDirection, bodyHeight: number, legendLineCount: number) => {
			applyPrimaryNav(bodyHeight, legendLineCount, (state, rows, viewportHeight) => {
				if ((options.primary.mode ?? "scroll") === "cursor") {
					const next = moveCursor({ cursor: state.cursor, scroll: state.scrollOffset, itemCount: rows.length, viewportHeight }, delta);
					state.cursor = next.cursor;
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
					const next = pageCursor({ cursor: state.cursor, scroll: state.scrollOffset, itemCount: rows.length, viewportHeight }, delta, pageSize);
					state.cursor = next.cursor;
					state.scrollOffset = next.scroll;
				} else {
					state.scrollOffset = pageScrollOffset({ offset: state.scrollOffset, contentLength: rows.length, viewportHeight }, delta, pageSize);
				}
			});
		};

		const homePrimary = (bodyHeight: number, legendLineCount: number) => {
			applyPrimaryNav(bodyHeight, legendLineCount, (state, rows, viewportHeight) => {
				if ((options.primary.mode ?? "scroll") === "cursor") {
					const next = homeCursor({ cursor: state.cursor, scroll: state.scrollOffset, itemCount: rows.length, viewportHeight });
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
					const next = endCursor({ cursor: state.cursor, scroll: state.scrollOffset, itemCount: rows.length, viewportHeight });
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
			if (collapse) entries.push({ key: collapseKey, label: collapse.label ?? "collapse" });
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

		const computeSelection = (bodyHeight: number) => {
			const provisionalCtx = makeContext(0, undefined, "", [], []);
			const primaryRows = resolveValue(options.primary.rows, provisionalCtx);
			const primaryMode = options.primary.mode ?? "scroll";
			let selectedIndex = 0;
			if (primaryMode === "cursor") {
				selectedIndex = ensureCursorVisible({
					cursor: primaryState.cursor,
					scroll: primaryState.scrollOffset,
					itemCount: primaryRows.length,
					viewportHeight: Math.max(1, bodyHeight),
				}).cursor;
			} else {
				selectedIndex = Math.min(primaryState.scrollOffset, Math.max(0, primaryRows.length - 1));
			}
			if (primaryRows.length === 0) selectedIndex = 0;
			const selectedRow = primaryRows[selectedIndex];
			const selectionKeyFn = options.primary.selectionKey ?? ((_row, index) => String(index));
			const selectedKey = selectedRow !== undefined ? selectionKeyFn(selectedRow, selectedIndex) : String(selectedIndex);
			return { primaryRows, selectedIndex, selectedRow, selectedKey };
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

				const { primaryRows, selectedIndex, selectedRow, selectedKey } = computeSelection(bodyHeight);
				const detailRows = resolveValue(options.detail.rows, makeContext(selectedIndex, selectedRow, selectedKey, primaryRows, []));
				const ctx = makeContext(selectedIndex, selectedRow, selectedKey, primaryRows, detailRows);

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
				const { primaryHeight, detailHeight } = listViewport(bodyHeight, legendLines.length);

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
					label: primaryTitle ?? "",
					labelColor: focus === "primary" ? "accent" : "text",
					labelBold: focus === "primary",
				});
				const topDetail = titledTopSegment(chromeTheme, {
					width: detailWidth,
					label: detailTitle ?? "",
					labelColor: focus === "detail" ? "accent" : "text",
					labelBold: focus === "detail",
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
						const text = renderFn(row, ctx);
						const selected = (options.primary.mode ?? "scroll") === "cursor" && absoluteIndex === primaryState.cursor && focus === "primary";
						return selected ? decorateRow(text, chromeTheme) : text;
					});

				const detailVisible = detailRows.slice(detailState.scrollOffset, detailState.scrollOffset + detailHeight);

				const primaryFooterText = resolveValue(options.primary.footer, ctx)
					?? ((options.primary.mode ?? "scroll") === "cursor" && primaryRows.length > 0
						? `${primaryState.cursor + 1}/${primaryRows.length}`
						: primaryRows.length > primaryHeight
							? formatScrollInfo(primaryState.scrollOffset, Math.max(0, primaryRows.length - primaryHeight), { style: "position" })
							: "");
				const detailFooterText = resolveValue(options.detail.footer, ctx)
					?? (detailRows.length > detailHeight
						? formatScrollInfo(detailState.scrollOffset, Math.max(0, detailRows.length - detailHeight), { style: "position" })
						: "");

				const bottomPrimary = titledBottomSegment(chromeTheme, primaryWidth, primaryFooterText, focus === "primary");
				const bottomDetail = titledBottomSegment(chromeTheme, detailWidth, detailFooterText, focus === "detail");
				const bottomBorder = primaryWidth === 0
					? corner("╰") + bottomDetail + corner("╯")
					: corner("╰") + bottomPrimary + corner("┴") + bottomDetail + corner("╯");

				const bodyLines: string[] = [];
				for (let row = 0; row < bodyHeight; row++) {
					let primaryCell = primaryVisible[row] ?? "";
					if (legendPlacement === "primary" && row === primaryHeight && legendLines.length > 0) {
						primaryCell = flatRule(chromeTheme, collapse?.label ?? "actions", primaryWidth);
					}
					if (legendPlacement === "primary" && row > primaryHeight) {
						const legendIndex = row - primaryHeight - 1;
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

				const { primaryRows, selectedIndex, selectedRow, selectedKey } = computeSelection(bodyHeight);
				const detailRows = resolveValue(options.detail.rows, makeContext(selectedIndex, selectedRow, selectedKey, primaryRows, []));
				const ctx = makeContext(selectedIndex, selectedRow, selectedKey, primaryRows, detailRows);

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
