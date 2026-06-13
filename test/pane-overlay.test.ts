import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	paneOverlay,
	type PaneOverlayComponent,
	type PaneOverlayOptions,
} from "../src/index.ts";

const theme = {
	fg(_color: string, text: string) {
		return text;
	},
	bold(text: string) {
		return `*${text}*`;
	},
};

function mount<T = undefined, Row = string>(
	options: PaneOverlayOptions<T, Row>,
	width = 100,
	rows = 24,
): {
	component: PaneOverlayComponent;
	render: () => string[];
	closeResult: () => T | undefined;
	requestCount: () => number;
} {
	let closed: T | undefined;
	let requests = 0;
	const tui = {
		terminal: { rows },
		requestRender() {
			requests++;
		},
	};
	const factory = paneOverlay(options);
	const component = factory(tui, theme, {}, (result) => {
		closed = result;
	}) as PaneOverlayComponent;
	return {
		component,
		render: () => component.render(width),
		closeResult: () => closed,
		requestCount: () => requests,
	};
}

function baseOptions<T = undefined, Row = string>(
	overrides: Partial<PaneOverlayOptions<T, Row>> = {},
): PaneOverlayOptions<T, Row> {
	return {
		height: 6,
		primary: {
			mode: "cursor",
			rows: ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"],
			renderRow: (row) => String(row),
		},
		detail: {
			rows: (ctx) => [`detail:${ctx.selectedRow}`],
			title: "Detail",
		},
		...overrides,
	} as PaneOverlayOptions<T, Row>;
}

test("renders primary/detail with selected-driven detail rows and titles", () => {
	const { render } = mount(baseOptions({
		primary: { mode: "cursor", rows: ["alpha", "beta", "gamma"], renderRow: (r) => String(r) },
		detail: { rows: (ctx) => [String(ctx.selectedRow).toUpperCase()], title: "Preview" },
	}));
	const lines = render();
	assert.ok(lines[0].includes("Preview"));
	assert.ok(lines[1].includes("alpha"));
	assert.ok(lines[1].includes("ALPHA"));
	assert.ok(lines.some((line) => line.includes("1/3")));
});

test("default legend includes u/d half-page and tab/arrow focus; q closes by default", () => {
	const { component, render, closeResult, requestCount } = mount(baseOptions());
	const lines = render();
	const footer = lines.slice(3).join("\n");
	assert.ok(lines.some((line) => /tab\/←\/→/.test(line)));
	assert.ok(lines.some((line) => /focus/.test(line)));
	assert.ok(lines.some((line) => /u\/d/.test(line)));
	assert.ok(lines.some((line) => /half-page/.test(line)));
	assert.ok(!lines.some((line) => /pgup|pgdn/i.test(line)));
	assert.ok(lines.some((line) => /q\/esc/.test(line)));
	assert.ok(lines.some((line) => /close/.test(line)));

	component.handleInput("q");
	assert.equal(closeResult(), undefined);
	assert.equal(requestCount(), 0);
});

test("closeKeys override omits q: q does not close, esc does", () => {
	const { component, closeResult } = mount(baseOptions({ closeKeys: ["escape", "ctrl+c"], closeResult: "closed" }));
	component.handleInput("q");
	assert.equal(closeResult(), undefined);
	component.handleInput("\u001b");
	assert.equal(closeResult(), "closed");
});

test("left/right arrows move focus; tab still moves focus", () => {
	const { component, render } = mount(baseOptions({
		primary: {
			mode: "cursor",
			rows: ["a"],
			renderRow: (r) => String(r),
			title: (ctx) => ctx.primaryFocus ? "PRIMARY*" : "PRIMARY",
		},
		detail: {
			rows: () => ["x"],
			title: (ctx) => ctx.detailFocus ? "DETAIL*" : "DETAIL",
		},
	}));
	assert.match(render()[0], /PRIMARY\*/);
	component.handleInput("\u001b[D"); // left arrow
	assert.match(render()[0], /DETAIL\*/);
	component.handleInput("\u001b[C"); // right arrow
	assert.match(render()[0], /PRIMARY\*/);
	component.handleInput("\t");
	assert.match(render()[0], /DETAIL\*/);
});

test("cursor primary: j/k move selection, detail rows update, onSelectionChange fires, u/d half-page moves by half viewport", () => {
	const changes: (string | undefined)[] = [];
	const { component, render } = mount(baseOptions({
		primary: {
			mode: "cursor",
			rows: ["a", "b", "c", "d", "e", "f", "g"],
			renderRow: (r) => String(r),
			onSelectionChange: (row) => changes.push(String(row)),
		},
		detail: { rows: (ctx) => [`detail:${ctx.selectedRow}`], title: "Detail" },
	}));

	assert.match(render()[1], /detail:a/);
	component.handleInput("j");
	assert.match(render()[1], /detail:b/);
	component.handleInput("j");
	assert.match(render()[1], /detail:c/);
	component.handleInput("k");
	assert.match(render()[1], /detail:b/);

	// viewport height is 6, half-page is 3
	component.handleInput("d");
	assert.match(render()[1], /detail:e/);
	component.handleInput("u");
	assert.match(render()[1], /detail:b/);

	component.handleInput("pageDown");
	assert.match(render()[1], /detail:b/);

	assert.deepEqual(changes, ["a", "b", "c", "b", "e", "b"]);
});

test("detail scroll: j/k/u/d/g/G scroll; perSelectionScroll keeps separate offsets; stickyBottom follows until user scrolls up", () => {
	let aCount = 6;
	const { component, render } = mount(baseOptions({
		height: 4,
		perSelectionScroll: true,
		stickyBottom: true,
		primary: {
			mode: "cursor",
			rows: ["A", "B", "C"],
			renderRow: (r) => String(r),
			selectionKey: (row) => String(row),
		},
		detail: {
			rows: (ctx) => {
				const count = ctx.selectedKey === "A" ? aCount : 10;
				return Array.from({ length: count }, (_, i) => `${ctx.selectedKey}:${i}`);
			},
			title: "Detail",
		},
	}));

	// detail for A is 6 rows, height 4, sticky bottom -> offset 2
	const initial = render();
	assert.match(initial[1], /A:2/);
	assert.match(initial[2], /A:3/);
	assert.match(initial[3], /A:4/);
	assert.match(initial[4], /A:5/);

	// grow A's rows while still sticky; should follow to new bottom (offset 4)
	aCount = 8;
	const grown = render();
	assert.match(grown[1], /A:4/);
	assert.match(grown[2], /A:5/);
	assert.match(grown[3], /A:6/);
	assert.match(grown[4], /A:7/);

	// move focus to detail and scroll up -> breaks sticky
	component.handleInput("\t");
	component.handleInput("k");
	assert.match(render()[1], /A:3/);

	// switch to B and scroll somewhere else
	component.handleInput("\t"); // back to primary
	component.handleInput("j"); // select B
	const bView = render();
	assert.match(bView[1], /B:6/); // sticky bottom, 10 rows -> offset 6
	component.handleInput("\t");
	component.handleInput("k");
	assert.match(render()[1], /B:5/);

	// switch back to A: should restore its saved offset (3)
	component.handleInput("\t");
	component.handleInput("k"); // select A
	assert.match(render()[1], /A:3/);

	// further growth after manual scroll should not follow
	aCount = 10;
	const manual = render();
	assert.match(manual[1], /A:3/);
});

test("custom action appears in legend and runs with selected row; banned keys consumed no-op", () => {
	const runs: (string | undefined)[] = [];
	const { component, render } = mount(baseOptions({
		primary: { mode: "cursor", rows: ["a", "b"], renderRow: (r) => String(r) },
		detail: { rows: (ctx) => [`detail:${ctx.selectedRow}`] },
		customActions: [
			{ keys: "x", label: "expand", run: (ctx) => runs.push(String(ctx.selectedRow)) },
		],
		bannedKeys: ["z"],
	}));

	const legend = render().join("\n");
	assert.match(legend, /x/);
	assert.match(legend, /expand/);

	component.handleInput("x");
	assert.deepEqual(runs, ["a"]);

	const before = render()[1];
	component.handleInput("z");
	assert.equal(render()[1], before);
});

test("[ and ] resize changes rendered widths when split enabled", () => {
	const { component, render } = mount(baseOptions({
		primary: { mode: "cursor", rows: ["a"], renderRow: (r) => String(r) },
		detail: { rows: () => ["x"] },
	}));
	const before = render()[1];
	component.handleInput("]");
	const afterGrow = render()[1];
	component.handleInput("[");
	const afterShrink = render()[1];
	assert.notEqual(before, afterGrow);
	assert.notEqual(afterGrow, afterShrink);
});

test("collapse key hides primary to collapsed width and forces detail focus", () => {
	const { component, render } = mount(baseOptions({
		primary: { mode: "cursor", rows: ["a"], renderRow: (r) => String(r) },
		detail: { rows: (ctx) => [`detail:${ctx.selectedRow}`], title: "Detail" },
		collapse: { key: "c", collapsedWidth: 1, label: "sidebar" },
	}), 60);
	const expanded = render()[1];
	component.handleInput("c");
	const collapsed = render()[1];
	// primary collapsed to 1 column, so detail content starts near the left edge
	assert.ok(collapsed.indexOf("detail:a") < expanded.indexOf("detail:a"));
	// after collapse, j scrolls the detail (focused) rather than moving primary selection
	component.handleInput("j");
	const scrolled = render()[1];
	assert.equal(scrolled, collapsed);
});

test("primary legend placement consumes primary viewport but not detail viewport", () => {
	const { render } = mount(baseOptions({
		height: 10,
		legendPlacement: "primary",
		primary: { mode: "cursor", rows: Array.from({ length: 20 }, (_, i) => `p-${i}`), renderRow: (r) => String(r) },
		detail: { rows: () => Array.from({ length: 20 }, (_, i) => `d-${i}`), title: "Detail" },
	}));
	const lines = render();
	// body lines are indices 1..10, bottom border at 11, footer legend omitted
	assert.equal(lines.length, 12);
	// primary list viewport is shrunk by legend lines + divider
	const primaryCells = lines.slice(1, 11).map((line) => line.split("│")[1]?.trim());
	assert.ok(primaryCells[0]?.includes("p-0"));
	assert.ok(primaryCells[1]?.includes("p-1"));
	assert.ok(primaryCells[2]?.includes("p-2"));
	// from row 3 onward primary shows the divider and legend, detail keeps full height
	assert.ok(!primaryCells[3]?.startsWith("p-"));
	assert.ok(lines[3].includes("d-2"));
	assert.ok(lines[10].includes("d-9"));
});

test("rendered lines are padded to the requested width", () => {
	const { render } = mount(baseOptions(), 72);
	for (const line of render()) {
		assert.equal(visibleWidth(line), 72);
	}
});
