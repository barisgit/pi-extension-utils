import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	boxRow,
	clipStyled,
	flatRule,
	formatScrollInfo,
	pad,
	padRight,
	renderFooter,
	renderHeader,
	renderKeyRow,
	row,
	titledBottomSegment,
	titledTopSegment,
} from "../src/index.ts";

const theme = {
	fg(_color: string, text: string) {
		return text;
	},
	bold(text: string) {
		return text;
	},
};

const red = (text: string) => `\u001b[31m${text}\u001b[39m`;

test("pad and padRight are visible-width aware with ANSI strings", () => {
	assert.equal(pad(red("ab"), 4), `${red("ab")}  `);
	assert.equal(pad(red("abcd"), 2), red("abcd"));

	const clipped = padRight(red("abcdef"), 3);
	assert.equal(visibleWidth(clipped), 3);
	assert.match(clipped, /^\u001b\[31mabc/);
	assert.equal(padRight(red("ab"), 4), `${red("ab")}  `);
});

test("clipStyled and box rows handle width edge cases", () => {
	assert.equal(clipStyled("abcdef", 0), "");
	assert.equal(clipStyled("abcdef", 3), "abc");
	assert.equal(padRight("abcd", 4), "abcd");
	assert.equal(padRight("abcdef", 3), "abc");
	assert.equal(row("abcdef", 5, theme), "│\u001b[0m...\u001b[0m│");
	assert.equal(row("abcdef", 1, theme), "││");
	assert.equal(boxRow(theme, "left", "right", 2, 3), "│\u001b[0m..\u001b[0m│\u001b[0m...\u001b[0m│");
});

test("titled segments and flat rule match expected chrome output", () => {
	assert.equal(titledTopSegment(theme, { width: 12, label: "Left" }), "─ Left ─────");
	assert.equal(titledTopSegment(theme, { width: 20, label: "Run", tail: "[ok]" }), "─ Run ─────── [ok] ─");
	assert.equal(titledTopSegment(theme, { width: 4, label: "abcdef" }), "─ a ");
	assert.equal(visibleWidth(titledTopSegment(theme, { width: 20, label: "1234567890", tail: "[ok]" })), 20);
	assert.equal(titledBottomSegment(theme, 10, "1/3", false), "─ 1/3 ────");
	assert.equal(titledBottomSegment(theme, 5, "abcdef", true), "─ \u001b[0m..\u001b[0m ");
	assert.equal(titledBottomSegment(theme, 4, "", false), "────");
	assert.equal(flatRule(theme, "keys", 10), "─ keys ───");
	assert.equal(flatRule(theme, "", 4), "────");
});

test("header, footer, key rows, and scroll info format exactly", () => {
	assert.equal(renderHeader("Hi", 8, theme), "╭──Hi──╮");
	assert.equal(renderFooter("Esc", 9, theme), "╰──Esc──╯");
	assert.equal(renderKeyRow("pgdn", "next page", 12, 5), "pgdn   next ");
	assert.equal(formatScrollInfo(0, 0), "");
	assert.equal(formatScrollInfo(2, 0), "↑ 2 more");
	assert.equal(formatScrollInfo(0, 3), "↓ 3 more");
	assert.equal(formatScrollInfo(2, 3), "↑ 2 more  ↓ 3 more");
});
