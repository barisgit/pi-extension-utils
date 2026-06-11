import assert from "node:assert/strict";
import test from "node:test";
import { dispatchNavKeys } from "../src/index.ts";

function recordDispatch(data: string, opts: Parameters<typeof dispatchNavKeys>[1] = {}): string[] {
	const calls: string[] = [];
	const consumed = dispatchNavKeys(data, {
		close: () => calls.push("close"),
		focusToggle: () => calls.push("focus"),
		move: (delta) => calls.push(`move:${delta}`),
		page: (delta) => calls.push(`page:${delta}`),
		home: () => calls.push("home"),
		end: () => calls.push("end"),
		...opts,
	});
	calls.unshift(`consumed:${consumed}`);
	return calls;
}

test("dispatches movement keys through matchesKey", () => {
	assert.deepEqual(recordDispatch("j"), ["consumed:true", "move:1"]);
	assert.deepEqual(recordDispatch("\u001b[B"), ["consumed:true", "move:1"]);
	assert.deepEqual(recordDispatch("k"), ["consumed:true", "move:-1"]);
	assert.deepEqual(recordDispatch("\u001b[A"), ["consumed:true", "move:-1"]);
});

test("dispatches focus, close, page, home, and end keys", () => {
	assert.deepEqual(recordDispatch("\t"), ["consumed:true", "focus"]);
	assert.deepEqual(recordDispatch("\u001b"), ["consumed:true", "close"]);
	assert.deepEqual(recordDispatch("\u0003"), ["consumed:true", "close"]);
	assert.deepEqual(recordDispatch("\u001b[6~"), ["consumed:true", "page:1"]);
	assert.deepEqual(recordDispatch("\u001b[5~"), ["consumed:true", "page:-1"]);
	assert.deepEqual(recordDispatch("\u001b[H"), ["consumed:true", "home"]);
	assert.deepEqual(recordDispatch("\u001b[F"), ["consumed:true", "end"]);
});

test("supports configurable q close without making q a default close key", () => {
	assert.deepEqual(recordDispatch("q"), ["consumed:false"]);
	assert.deepEqual(recordDispatch("q", { closeKeys: ["escape", "ctrl+c", "q"] }), ["consumed:true", "close"]);
});

test("recognizes g and shift+g including Kitty CSI-u", () => {
	assert.deepEqual(recordDispatch("g"), ["consumed:true", "home"]);
	assert.deepEqual(recordDispatch("G"), ["consumed:true", "end"]);
	assert.deepEqual(recordDispatch("\u001b[103;1u"), ["consumed:true", "home"]);
	assert.deepEqual(recordDispatch("\u001b[71;2u"), ["consumed:true", "end"]);
});

test("banned keys are consumed but ignored", () => {
	assert.deepEqual(recordDispatch("b", { bannedKeys: ["b", "r", "p", "a", "c", "return", "delete"] }), ["consumed:true"]);
	assert.deepEqual(recordDispatch("\r", { bannedKeys: ["return", "delete"] }), ["consumed:true"]);
	assert.deepEqual(recordDispatch("\u001b[3~", { bannedKeys: ["return", "delete"] }), ["consumed:true"]);
});

test("extra bindings run before banned and common navigation", () => {
	assert.deepEqual(recordDispatch("j", { extraBindings: [{ keys: "j", handler: () => undefined }] }), ["consumed:true"]);
	assert.deepEqual(recordDispatch("a", { bannedKeys: ["a"], extraBindings: [{ keys: "a", handler: () => undefined }] }), ["consumed:true"]);
	const calls: string[] = [];
	const consumed = dispatchNavKeys("s", {
		extraBindings: [{ keys: ["s", "space"], handler: () => calls.push("sidebar") }],
	});
	assert.equal(consumed, true);
	assert.deepEqual(calls, ["sidebar"]);
});
