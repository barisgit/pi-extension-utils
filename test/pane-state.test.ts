import assert from "node:assert/strict";
import test from "node:test";
import {
	clampScrollOffset,
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
	togglePaneFocus,
	toggleSidebar,
} from "../src/index.ts";

test("split-pane width math clamps at min, max, cap, and right boundary", () => {
	assert.deepEqual(computeSplitPaneLayout({
		totalWidth: 120,
		leftFraction: 0.4,
		minLeftWidth: 28,
		minRightWidth: 24,
		leftMaxWidth: 110,
	}), {
		leftWidth: 48,
		rightWidth: 69,
		interiorWidth: 117,
		leftFraction: 0.4,
	});

	assert.equal(computeSplitPaneLayout({ totalWidth: 80, leftFraction: 0.1, minLeftWidth: 28, minRightWidth: 24 }).leftWidth, 28);
	assert.equal(computeSplitPaneLayout({ totalWidth: 220, leftFraction: 0.8, minLeftWidth: 28, minRightWidth: 24, leftMaxWidth: 110 }).leftWidth, 110);
	assert.equal(computeSplitPaneLayout({ totalWidth: 60, leftFraction: 0.9, minLeftWidth: 28, minRightWidth: 24 }).leftWidth, 33);
	assert.equal(computeSplitPaneLayout({ totalWidth: 60, leftFraction: 0.5, minLeftWidth: 20, minRightWidth: 24, fractionBasis: "interior" }).leftWidth, 29);
});

test("resizeSplitPane shifts by a step and does not accumulate past clamped widths", () => {
	const grown = resizeSplitPane({
		totalWidth: 120,
		leftFraction: 0.4,
		direction: 1,
		stepCols: 4,
		minLeftWidth: 28,
		minRightWidth: 24,
		leftMaxWidth: 110,
	});
	assert.equal(grown.leftWidth, 52);
	assert.equal(grown.rightWidth, 65);

	const capped = resizeSplitPane({
		totalWidth: 120,
		leftFraction: 0.7,
		direction: 1,
		stepCols: 4,
		minLeftWidth: 28,
		minRightWidth: 24,
		leftMaxWidth: 84,
	});
	assert.equal(capped.leftWidth, 84);
	assert.equal(capped.leftFraction, 0.7);

	const shrunk = resizeSplitPane({
		totalWidth: 80,
		leftFraction: 0.4,
		direction: -1,
		stepCols: 4,
		minLeftWidth: 20,
		minRightWidth: 24,
		fractionBasis: "interior",
	});
	assert.equal(shrunk.leftWidth, 27);
});

test("fixed sidebar layout handles expanded, collapsed, and focus toggle boundaries", () => {
	assert.deepEqual(computeFixedSidebarLayout({
		totalWidth: 100,
		collapsed: false,
		leftWidth: 32,
		minLeftWidth: 20,
		minRightWidth: 24,
	}), {
		collapsed: false,
		leftWidth: 32,
		rightWidth: 65,
		interiorWidth: 97,
	});

	assert.deepEqual(computeFixedSidebarLayout({
		totalWidth: 100,
		collapsed: true,
		leftWidth: 32,
		collapsedLeftWidth: 0,
	}), {
		collapsed: true,
		leftWidth: 0,
		rightWidth: 98,
		interiorWidth: 98,
	});

	assert.equal(computeFixedSidebarLayout({ totalWidth: 50, collapsed: false, leftWidth: 40, minLeftWidth: 20, minRightWidth: 24 }).leftWidth, 23);
	assert.equal(togglePaneFocus("left"), "right");
	assert.deepEqual(toggleSidebar({ collapsed: false, focus: "left" }), { collapsed: true, focus: "right" });
	assert.deepEqual(toggleSidebar({ collapsed: true, focus: "right" }), { collapsed: false, focus: "right" });
});

test("raw scroll offsets clamp at start, end, and short content", () => {
	assert.equal(clampScrollOffset(-3, 20, 5), 0);
	assert.equal(clampScrollOffset(99, 20, 5), 15);
	assert.equal(clampScrollOffset(7, 3, 10), 0);
	assert.equal(moveScrollOffset({ offset: 14, contentLength: 20, viewportHeight: 5 }, 4), 15);
	assert.equal(pageScrollOffset({ offset: 3, contentLength: 30, viewportHeight: 10 }, 1), 13);
	assert.equal(pageScrollOffset({ offset: 3, contentLength: 30, viewportHeight: 10 }, -1), 0);
	assert.equal(homeScrollOffset(), 0);
	assert.equal(endScrollOffset(20, 5), 15);
});

test("cursor ensure-visible tracks top and bottom viewport edges", () => {
	assert.deepEqual(ensureCursorVisible({ cursor: 2, scroll: 5, itemCount: 20, viewportHeight: 5 }), {
		cursor: 2,
		scroll: 2,
		itemCount: 20,
		viewportHeight: 5,
	});
	assert.deepEqual(ensureCursorVisible({ cursor: 9, scroll: 3, itemCount: 20, viewportHeight: 5 }), {
		cursor: 9,
		scroll: 5,
		itemCount: 20,
		viewportHeight: 5,
	});
	assert.deepEqual(ensureCursorVisible({ cursor: 4, scroll: 0, itemCount: 5, viewportHeight: 10 }), {
		cursor: 4,
		scroll: 0,
		itemCount: 5,
		viewportHeight: 10,
	});
});

test("cursor move, page, home, and end clamp near boundaries", () => {
	assert.deepEqual(moveCursor({ cursor: 0, scroll: 0, itemCount: 3, viewportHeight: 5 }, -1), {
		cursor: 0,
		scroll: 0,
		itemCount: 3,
		viewportHeight: 5,
	});
	assert.deepEqual(pageCursor({ cursor: 18, scroll: 12, itemCount: 20, viewportHeight: 5 }, 1), {
		cursor: 19,
		scroll: 15,
		itemCount: 20,
		viewportHeight: 5,
	});
	assert.deepEqual(pageCursor({ cursor: 2, scroll: 2, itemCount: 20, viewportHeight: 5 }, -1), {
		cursor: 0,
		scroll: 0,
		itemCount: 20,
		viewportHeight: 5,
	});
	assert.deepEqual(homeCursor({ cursor: 10, scroll: 8, itemCount: 20, viewportHeight: 5 }), {
		cursor: 0,
		scroll: 0,
		itemCount: 20,
		viewportHeight: 5,
	});
	assert.deepEqual(endCursor({ cursor: 0, scroll: 0, itemCount: 20, viewportHeight: 5 }), {
		cursor: 19,
		scroll: 15,
		itemCount: 20,
		viewportHeight: 5,
	});
});

test("recompute after terminal shrink reclamps split widths and viewports", () => {
	const layout = computeSplitPaneLayout({
		totalWidth: 50,
		leftFraction: 0.7,
		minLeftWidth: 28,
		minRightWidth: 24,
		leftMaxWidth: 110,
	});
	assert.equal(layout.leftWidth, 23);
	assert.equal(layout.rightWidth, 24);
	assert.equal(clampScrollOffset(40, 30, 8), 22);
	assert.deepEqual(ensureCursorVisible({ cursor: 18, scroll: 15, itemCount: 20, viewportHeight: 3 }), {
		cursor: 18,
		scroll: 16,
		itemCount: 20,
		viewportHeight: 3,
	});
});
