// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import hostExtension from "../index.ts";
import {
	connect,
	createLogger,
	EVENTS,
	REMINDER_ANNOUNCE_NOW_EVENT,
	REMINDER_CLEAR_SOURCE_EVENT,
	REMINDER_REMOVE_EVENT,
	REMINDER_UPSERT_EVENT,
} from "../src/index.ts";
import { utilsConfig } from "../src/utils-config.ts";

function createBus() {
	const handlers = new Map();
	return {
		emitted: [],
		emit(channel, data) {
			this.emitted.push({ channel, data });
			for (const handler of handlers.get(channel) ?? []) handler(data);
		},
		on(channel, handler) {
			const list = handlers.get(channel) ?? [];
			list.push(handler);
			handlers.set(channel, list);
			return () => {
				const next = (handlers.get(channel) ?? []).filter((entry) => entry !== handler);
				handlers.set(channel, next);
			};
		},
	};
}

function createCtx() {
	const widgets = new Map();
	const calls = [];
	return {
		widgets,
		calls,
		ui: {
			setWidget(key, factory, opts = {}) {
				const placement = opts.placement ?? "belowEditor";
				calls.push({ key, factory, placement });
				if (factory === undefined) widgets.delete(`${placement}:${key}`);
				else widgets.set(`${placement}:${key}`, { key, factory, placement });
			},
		},
	};
}

function createPi(bus, ctx) {
	return {
		events: bus,
		on(event, handler) {
			if (event === "session_start") handler({ type: "session_start" }, ctx);
		},
		registerCommand() {},
	};
}

function setAgentDir(agentDir) {
	// Redirect getAgentDir() regardless of which app fork's SDK is installed:
	// the env var prefix derives from the SDK's APP_NAME (e.g. PI_ upstream, FO_ fork).
	const envVars = ["PI_CODING_AGENT_DIR", "FO_CODING_AGENT_DIR"];
	const previous = envVars.map((name) => [name, process.env[name]]);
	for (const name of envVars) process.env[name] = agentDir;
	return () => {
		for (const [name, value] of previous) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
		utilsConfig.reload();
	};
}

function writeCorruptUtilsConfig(agentDir) {
	mkdirSync(join(agentDir, "config"), { recursive: true });
	writeFileSync(join(agentDir, "config", "utils.jsonc"), `{
	"logging": { "level": "warn" },
	"reminders": { "debugShowAllInTui": false, }
`);
	assert.throws(() => utilsConfig.reload(), /Invalid JSONC/);
}

function readJsonl(path) {
	return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function textFactory(text) {
	return () => ({
		render() {
			return [text];
		},
		invalidate() {},
	});
}

function renderHost(ctx, placement = "belowEditor") {
	const entry = [...ctx.widgets.values()].find((widget) => widget.placement === placement && widget.key.startsWith("pi-extension-utils-"));
	assert.ok(entry, `missing host widget for ${placement}`);
	return entry.factory({}, {}).render(80);
}

test("handshake works client before host and upgrades to coordinated", () => {
	const bus = createBus();
	const clientCtx = createCtx();
	const hostCtx = createCtx();
	const client = connect(createPi(bus, clientCtx), { ctx: clientCtx, clientId: "client-a" });
	client.widgets.set("belowEditor", "status", textFactory("fallback"));
	assert.equal(client.mode, "fallback");
	assert.equal(clientCtx.widgets.size, 1);

	hostExtension(createPi(bus, hostCtx));

	assert.equal(client.mode, "coordinated");
	assert.equal(clientCtx.widgets.size, 0);
	assert.deepEqual(renderHost(hostCtx), ["fallback"]);
});

test("handshake works host before client", () => {
	const bus = createBus();
	const hostCtx = createCtx();
	hostExtension(createPi(bus, hostCtx));
	const clientCtx = createCtx();
	const client = connect(createPi(bus, clientCtx), { ctx: clientCtx, clientId: "client-b" });
	client.widgets.set("belowEditor", "status", textFactory("coordinated"));

	assert.equal(client.mode, "coordinated");
	assert.equal(clientCtx.widgets.size, 0);
	assert.deepEqual(renderHost(hostCtx), ["coordinated"]);
});

test("repeated ready does not double attach", () => {
	const bus = createBus();
	const hostCtx = createCtx();
	hostExtension(createPi(bus, hostCtx));
	const clientCtx = createCtx();
	const client = connect(createPi(bus, clientCtx), { ctx: clientCtx, clientId: "client-c" });
	client.widgets.set("belowEditor", "status", textFactory("one"));
	bus.emit(EVENTS.ready, { protocolVersion: 1, clientId: "host-again" });
	bus.emit(EVENTS.ready, { protocolVersion: 1, clientId: "host-again" });

	assert.deepEqual(renderHost(hostCtx), ["one"]);
	const registerEvents = bus.emitted.filter((event) => event.channel === EVENTS.registerWidget && event.data.clientId === "client-c");
	assert.equal(registerEvents.length, 1);
});

test("no host fallback renders directly and remove clears", () => {
	const bus = createBus();
	const ctx = createCtx();
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-d" });
	client.widgets.set("aboveEditor", "status", textFactory("direct"));
	assert.equal(client.mode, "fallback");
	assert.equal(ctx.widgets.size, 1);
	client.widgets.remove("aboveEditor", "status");
	assert.equal(ctx.widgets.size, 0);
});

test("reminders face emits host payloads and lists host snapshot", async () => {
	const bus = createBus();
	const hostCtx = createCtx();
	hostExtension(createPi(bus, hostCtx));
	const ctx = createCtx();
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-reminders" });
	const intent = {
		source: "test-source",
		id: "one",
		label: "Test",
		text: "remember this",
		priority: 5,
		ttl: "session",
	};

	client.reminders.upsert(intent);
	assert.deepEqual(bus.emitted.at(-1), { channel: REMINDER_UPSERT_EVENT, data: intent });
	const snapshot = await client.reminders.list("test-source");
	assert.equal(snapshot.count, 1);
	assert.equal(snapshot.reminders.length, 1);
	assert.deepEqual({ ...snapshot.reminders[0], createdAt: undefined, updatedAt: undefined }, {
		...intent,
		display: true,
		repeatEveryTurns: undefined,
		metadata: undefined,
		createdAt: undefined,
		updatedAt: undefined,
	});
	assert.equal(typeof snapshot.reminders[0].createdAt, "number");
	assert.equal(typeof snapshot.reminders[0].updatedAt, "number");

	client.reminders.announceNow({ source: "test-source", id: "one" });
	assert.deepEqual(bus.emitted.at(-1), { channel: REMINDER_ANNOUNCE_NOW_EVENT, data: { source: "test-source", id: "one" } });
	client.reminders.remove("test-source", "one");
	assert.deepEqual(bus.emitted.at(-1), { channel: REMINDER_REMOVE_EVENT, data: { source: "test-source", id: "one" } });
	assert.deepEqual(await client.reminders.list("test-source"), { count: 0, reminders: [] });

	client.reminders.upsert({ ...intent, id: "two" });
	client.reminders.clearSource("test-source");
	assert.deepEqual(bus.emitted.at(-1), { channel: REMINDER_CLEAR_SOURCE_EVENT, data: { source: "test-source" } });
	assert.deepEqual(await client.reminders.list("test-source"), { count: 0, reminders: [] });
});

test("reminders face is a safe no-host fallback", async () => {
	const bus = createBus();
	const ctx = createCtx();
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-reminders-fallback" });

	assert.doesNotThrow(() => client.reminders.upsert({ source: "fallback", id: "one", text: "one" }));
	assert.doesNotThrow(() => client.reminders.remove("fallback", "one"));
	assert.doesNotThrow(() => client.reminders.clearSource("fallback"));
	assert.doesNotThrow(() => client.reminders.announceNow({ source: "fallback", id: "one" }));
	assert.deepEqual(await client.reminders.list("fallback"), { count: 0, reminders: [] });
});

test("late host upgrades fallback widgets without duplicates", () => {
	const bus = createBus();
	const clientCtx = createCtx();
	const client = connect(createPi(bus, clientCtx), { ctx: clientCtx, clientId: "client-e" });
	client.widgets.set("belowEditor", "status", textFactory("late"));
	const hostCtx = createCtx();
	hostExtension(createPi(bus, hostCtx));
	bus.emit(EVENTS.ready, { protocolVersion: 1, clientId: "extra-ready" });

	assert.equal(clientCtx.widgets.size, 0);
	assert.deepEqual(renderHost(hostCtx), ["late"]);
	const registerEvents = bus.emitted.filter((event) => event.channel === EVENTS.registerWidget && event.data.clientId === "client-e");
	assert.equal(registerEvents.length, 1);
});

test("ordering across clients and unregister removes only that client", () => {
	const bus = createBus();
	const hostCtx = createCtx();
	hostExtension(createPi(bus, hostCtx));
	const ctxA = createCtx();
	const ctxB = createCtx();
	const a = connect(createPi(bus, ctxA), { ctx: ctxA, clientId: "client-f-a" });
	const b = connect(createPi(bus, ctxB), { ctx: ctxB, clientId: "client-f-b" });
	a.widgets.set("belowEditor", "a1", textFactory("a1"), { order: 10 });
	b.widgets.set("belowEditor", "b1", textFactory("b1"), { order: 5 });
	a.widgets.set("belowEditor", "a2", textFactory("a2"), { order: 10 });

	assert.deepEqual(renderHost(hostCtx), ["b1", "a1", "a2"]);
	a.dispose();
	assert.deepEqual(renderHost(hostCtx), ["b1"]);
});

test("fullscreen blanks, restores, stacks, releases idempotently, and clears on dispose", () => {
	const bus = createBus();
	const hostCtx = createCtx();
	hostExtension(createPi(bus, hostCtx));
	const ctxA = createCtx();
	const ctxB = createCtx();
	const a = connect(createPi(bus, ctxA), { ctx: ctxA, clientId: "client-g-a" });
	const b = connect(createPi(bus, ctxB), { ctx: ctxB, clientId: "client-g-b" });
	a.widgets.set("belowEditor", "a", textFactory("a"));
	b.widgets.set("belowEditor", "b", textFactory("b"));
	assert.deepEqual(renderHost(hostCtx), ["a", "b"]);

	const leaseA = a.fullscreen.acquire();
	assert.deepEqual(renderHost(hostCtx), []);
	const leaseB = b.fullscreen.acquire();
	assert.deepEqual(renderHost(hostCtx), []);
	leaseA.release();
	assert.deepEqual(renderHost(hostCtx), []);
	leaseA.release();
	assert.deepEqual(renderHost(hostCtx), []);
	leaseB.release();
	assert.deepEqual(renderHost(hostCtx), ["a", "b"]);

	const leaseC = a.fullscreen.acquire();
	assert.deepEqual(renderHost(hostCtx), []);
	a.dispose();
	assert.deepEqual(renderHost(hostCtx), ["b"]);
	leaseC.release();
	assert.deepEqual(renderHost(hostCtx), ["b"]);
});

test("fallback fullscreen hides and restores own widgets", () => {
	const bus = createBus();
	const ctx = createCtx();
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-g-fallback" });
	const a = textFactory("a");
	const b = textFactory("b");
	client.widgets.set("belowEditor", "a", a);
	client.widgets.set("aboveEditor", "b", b);
	assert.deepEqual([...ctx.widgets.keys()], ["belowEditor:a", "aboveEditor:b"]);

	const leaseA = client.fullscreen.acquire();
	assert.equal(ctx.widgets.size, 0);
	const leaseB = client.fullscreen.acquire();
	leaseA.release();
	assert.equal(ctx.widgets.size, 0);
	leaseA.release();
	assert.equal(ctx.widgets.size, 0);
	leaseB.release();
	assert.deepEqual([...ctx.widgets.keys()], ["belowEditor:a", "aboveEditor:b"]);

	const leaseC = client.fullscreen.acquire();
	client.dispose();
	leaseC.release();
	assert.equal(ctx.widgets.size, 0);
});

test("ui.fullscreen acquires a lease around ctx.ui.custom and restores after", async () => {
	const bus = createBus();
	const hostCtx = createCtx();
	hostExtension(createPi(bus, hostCtx));
	const ctx = createCtx();
	let customCalls = 0;
	ctx.ui.custom = async (factory) => {
		customCalls++;
		// the lease must already be held while the custom UI is up
		assert.deepEqual(renderHost(hostCtx), []);
		return "result";
	};
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-fs" });
	client.widgets.set("belowEditor", "w", textFactory("w"));
	assert.deepEqual(renderHost(hostCtx), ["w"]);

	const result = await client.ui.fullscreen(() => ({ render: () => [] }));
	assert.equal(result, "result");
	assert.equal(customCalls, 1);
	assert.deepEqual(renderHost(hostCtx), ["w"]);
});

test("ui.fullscreen releases the lease when the custom UI throws", async () => {
	const bus = createBus();
	const hostCtx = createCtx();
	hostExtension(createPi(bus, hostCtx));
	const ctx = createCtx();
	ctx.ui.custom = async () => {
		throw new Error("boom");
	};
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-fs-throw" });
	client.widgets.set("belowEditor", "w", textFactory("w"));

	await assert.rejects(() => client.ui.fullscreen(() => ({ render: () => [] })), /boom/);
	assert.deepEqual(renderHost(hostCtx), ["w"]);
});

test("ui.fullscreen works in fallback mode: hides own widgets, restores after", async () => {
	const bus = createBus();
	const ctx = createCtx();
	ctx.ui.custom = async () => {
		assert.equal(ctx.widgets.size, 0);
		return 42;
	};
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-fs-fb" });
	client.widgets.set("belowEditor", "w", textFactory("w"));
	assert.equal(ctx.widgets.size, 1);

	const result = await client.ui.fullscreen(() => ({ render: () => [] }));
	assert.equal(result, 42);
	assert.equal(ctx.widgets.size, 1);
});

test("ui.fullscreen throws a clear error without acquiring a lease when ctx.ui.custom is unavailable", async () => {
	const bus = createBus();
	const hostCtx = createCtx();
	hostExtension(createPi(bus, hostCtx));
	const ctx = createCtx();
	// no ctx.ui.custom: simulates non-interactive mode
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-fs-noninteractive" });
	client.widgets.set("belowEditor", "w", textFactory("w"));

	await assert.rejects(() => client.ui.fullscreen(() => ({ render: () => [] })), /ctx\.ui\.custom is unavailable/);
	// widgets must remain visible: no lease was taken
	assert.deepEqual(renderHost(hostCtx), ["w"]);
});

test("host accepts older protocol payloads and ignores unknown fields", () => {
	const bus = createBus();
	const hostCtx = createCtx();
	assert.doesNotThrow(() => hostExtension(createPi(bus, hostCtx)));
	assert.doesNotThrow(() => {
		bus.emit(EVENTS.registerWidget, {
			protocolVersion: 0,
			clientId: "old-client",
			placement: "belowEditor",
			key: "old",
			order: 0,
			factory: textFactory("old"),
			futureField: true,
		});
	});
	assert.deepEqual(renderHost(hostCtx), ["old"]);
	assert.doesNotThrow(() => bus.emit(EVENTS.registerWidget, { protocolVersion: 999, clientId: "future" }));
	assert.deepEqual(renderHost(hostCtx), ["old"]);
});

test("corrupt utils config does not stop widget host registration", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-extension-utils-agent-"));
	const restoreAgentDir = setAgentDir(agentDir);
	try {
		writeCorruptUtilsConfig(agentDir);
		const bus = createBus();
		const clientCtx = createCtx();
		const client = connect(createPi(bus, clientCtx), { ctx: clientCtx, clientId: "client-corrupt-config" });
		client.widgets.set("belowEditor", "status", textFactory("survives"));

		const hostCtx = createCtx();
		assert.doesNotThrow(() => hostExtension(createPi(bus, hostCtx)));
		assert.equal(client.mode, "coordinated");
		assert.deepEqual(renderHost(hostCtx), ["survives"]);
	} finally {
		restoreAgentDir();
	}
});

test("logger uses utils config defaults when options omit logger settings", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-extension-utils-agent-"));
	const logDir = mkdtempSync(join(tmpdir(), "pi-extension-utils-log-"));
	const restoreAgentDir = setAgentDir(agentDir);
	try {
		utilsConfig.reload();
		mkdirSync(join(agentDir, "config"), { recursive: true });
		writeFileSync(join(agentDir, "config", "utils.jsonc"), `{
	"logging": {
		"level": "warn",
		"maxFiles": 1,
		"maxBytes": 70
	},
	"reminders": {
		"debugShowAllInTui": false
	}
}
`);
		utilsConfig.reload();
		const logger = createLogger("configured", { dir: logDir });
		logger.info("hidden info");
		logger.warn("first warning that rotates");
		logger.error("second error that rotates");
		const file = join(logDir, "configured.jsonl");
		const rotated = join(logDir, "configured.jsonl.1");
		assert.equal(existsSync(file), true);
		assert.equal(existsSync(rotated), true);
		assert.deepEqual(readJsonl(file).map(({ level, message }) => ({ level, message })), [{ level: "error", message: "second error that rotates" }]);
		assert.deepEqual(readJsonl(rotated).map(({ level, message }) => ({ level, message })), [{ level: "warn", message: "first warning that rotates" }]);
		assert.equal([...readJsonl(file), ...readJsonl(rotated)].some((entry) => entry.message === "hidden info"), false);
	} finally {
		restoreAgentDir();
	}
});

test("logger falls back to defaults when utils config is corrupt", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-extension-utils-agent-"));
	const logDir = mkdtempSync(join(tmpdir(), "pi-extension-utils-log-"));
	const restoreAgentDir = setAgentDir(agentDir);
	try {
		writeCorruptUtilsConfig(agentDir);
		const logger = createLogger("corrupt", { dir: logDir });
		logger.info("still writes with defaults");
		assert.deepEqual(readJsonl(join(logDir, "corrupt.jsonl")).map(({ level, message }) => ({ level, message })), [{ level: "info", message: "still writes with defaults" }]);
	} finally {
		restoreAgentDir();
	}
});

test("logger writes JSONL lines, creates dirs, rotates, filters levels, and rejects path separators", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-extension-utils-"));
	const logger = createLogger("test", { dir, maxBytes: 70, maxFiles: 2, level: "info" });
	logger.debug("hidden debug");
	logger.info("first message that should fit");
	logger.warn("second message that should rotate");
	logger.error("third message that should rotate again");
	const file = join(dir, "test.jsonl");
	const firstRotated = join(dir, "test.jsonl.1");
	const secondRotated = join(dir, "test.jsonl.2");
	assert.equal(existsSync(file), true);
	assert.equal(existsSync(firstRotated), true);
	assert.equal(existsSync(secondRotated), true);
	assert.deepEqual(readJsonl(file).map(({ level, message }) => ({ level, message })), [{ level: "error", message: "third message that should rotate again" }]);
	assert.deepEqual(readJsonl(firstRotated).map(({ level, message }) => ({ level, message })), [{ level: "warn", message: "second message that should rotate" }]);
	assert.deepEqual(readJsonl(secondRotated).map(({ level, message }) => ({ level, message })), [{ level: "info", message: "first message that should fit" }]);
	assert.equal([...readJsonl(file), ...readJsonl(firstRotated), ...readJsonl(secondRotated)].some((entry) => entry.message === "hidden debug"), false);
	for (const entry of readJsonl(file)) assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(logger.isEnabled("debug"), false);
	logger.setLevel("debug");
	assert.equal(logger.isEnabled("debug"), true);
	assert.throws(() => createLogger("bad/name", { dir }), /path separators/);
	assert.throws(() => createLogger("bad\\name", { dir }), /path separators/);
});

test("logger flattens structured fields and preserves reserved fields", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-extension-utils-"));
	const logger = createLogger("fields", { dir, maxBytes: 0, level: "debug" });
	logger.info("session started", {
		cwd: "/repo",
		command: "demo",
		attempt: 2,
		ts: "caller ts",
		level: "error",
		message: "caller message",
	});
	const [entry] = readJsonl(join(dir, "fields.jsonl"));
	assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(entry.level, "info");
	assert.equal(entry.message, "session started");
	assert.equal(entry.cwd, "/repo");
	assert.equal(entry.command, "demo");
	assert.equal(entry.attempt, 2);
});

test("logger supports silent level and maxBytes zero", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-extension-utils-"));
	const silent = createLogger("silent", { dir, level: "silent" });
	silent.error("hidden");
	assert.equal(silent.isEnabled("error"), false);
	assert.equal(existsSync(join(dir, "silent.jsonl")), false);

	const noRotate = createLogger("no-rotate", { dir, maxBytes: 0, maxFiles: 1, level: "debug" });
	noRotate.info("first message that would rotate if maxBytes were active");
	noRotate.error("second message that would rotate if maxBytes were active");
	assert.equal(existsSync(join(dir, "no-rotate.jsonl")), true);
	assert.equal(existsSync(join(dir, "no-rotate.jsonl.1")), false);
	assert.deepEqual(readJsonl(join(dir, "no-rotate.jsonl")).map(({ level, message }) => ({ level, message })), [
		{ level: "info", message: "first message that would rotate if maxBytes were active" },
		{ level: "error", message: "second message that would rotate if maxBytes were active" },
	]);
});
