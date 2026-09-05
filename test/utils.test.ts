// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import hostExtension from "../index.ts";
import { registerWidgetHost } from "../src/widgets/host.ts";
import { connectWidgetCoordinator } from "../src/widgets/client.ts";
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

function createCtx(tui = {}, theme = {}) {
	const widgets = new Map();
	const calls = [];
	return {
		widgets,
		calls,
		ui: {
			setWidget(key, factory, opts = {}) {
				const placement = opts.placement ?? "aboveEditor";
				calls.push({ key, factory, placement });
				for (const [id, widget] of widgets) {
					if (widget.key !== key) continue;
					widget.component.dispose?.();
					widgets.delete(id);
				}
				if (factory !== undefined) {
					const component = factory(tui, theme);
					widgets.set(`${placement}:${key}`, { key, factory, component, placement });
				}
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
	return entry.component.render(80);
}

test("host disposes owned children on replacement, removal, fullscreen and teardown", () => {
	const bus = createBus();
	const ctx = createCtx();
	registerWidgetHost(createPi(bus, ctx));
	const client = connectWidgetCoordinator(createPi(bus, ctx), { ctx, clientId: "owned" });
	const children = [];
	const factory = () => {
		const child = {
			disposals: 0,
			render() { assert.equal(this.disposals, 0); return ["live"]; },
			invalidate() { assert.equal(this.disposals, 0); },
			dispose() { this.disposals++; },
		};
		children.push(child);
		return child;
	};
	client.widgets.set("belowEditor", "status", factory);
	const firstHost = [...ctx.widgets.values()][0].component;
	assert.deepEqual(renderHost(ctx), ["live"]);
	assert.equal(children[0].disposals, 0);
	client.widgets.set("belowEditor", "status", factory);
	assert.deepEqual(children.map((child) => child.disposals), [1, 0]);
	firstHost.dispose();
	assert.deepEqual(firstHost.render(80), []);
	firstHost.invalidate();
	assert.equal(children[0].disposals, 1);
	client.widgets.remove("belowEditor", "status");
	assert.deepEqual(children.map((child) => child.disposals), [1, 1]);
	client.widgets.set("belowEditor", "status", factory);
	const lease = client.fullscreen.acquire();
	assert.deepEqual(children.map((child) => child.disposals), [1, 1, 1]);
	lease.release();
	assert.deepEqual(renderHost(ctx), ["live"]);
	client.dispose();
	client.dispose();
	assert.deepEqual(children.map((child) => child.disposals), [1, 1, 1, 1]);
	const other = connectWidgetCoordinator(createPi(bus, ctx), { ctx, clientId: "remaining" });
	other.widgets.set("aboveEditor", "status", factory);
	other.widgets.set("belowEditor", "status", factory);
	// Pi's resetExtensionUI clears every raw widget on teardown.
	for (const entry of [...ctx.widgets.values()]) ctx.ui.setWidget(entry.key, undefined);
	assert.ok(children.every((child) => child.disposals === 1));
});

test("host drops failed children once and isolates throwing cleanup", (t) => {
	t.mock.method(console, "warn", () => {});
	const bus = createBus();
	const ctx = createCtx();
	registerWidgetHost(createPi(bus, ctx));
	const client = connectWidgetCoordinator(createPi(bus, ctx), { ctx, clientId: "failed" });
	let failedDisposals = 0;
	let healthyDisposals = 0;
	client.widgets.set("belowEditor", "broken", () => ({
		render() { throw new Error("render failed"); },
		invalidate() {},
		dispose() { failedDisposals++; throw new Error("cleanup failed"); },
	}));
	assert.deepEqual(renderHost(ctx), []);
	assert.equal(failedDisposals, 1);
	assert.deepEqual(renderHost(ctx), []);
	assert.equal(failedDisposals, 1);
	client.widgets.set("belowEditor", "healthy", () => ({
		render: () => ["healthy"],
		invalidate() {},
		dispose() { healthyDisposals++; },
	}));
	client.widgets.set("belowEditor", "factory-failure", () => { throw new Error("factory failed"); });
	// Re-registration remounts existing records, even a previously failed one.
	assert.equal(failedDisposals, 2);
	assert.equal(healthyDisposals, 1);
	assert.deepEqual(renderHost(ctx), ["healthy"]);
	assert.equal(failedDisposals, 3);
	client.dispose();
	client.dispose();
	assert.equal(failedDisposals, 3);
	assert.equal(healthyDisposals, 2);
});

test("host releases shared child identity only once after detaching every occurrence", (t) => {
	t.mock.method(console, "warn", () => {});
	for (const fails of [false, true]) {
		const bus = createBus();
		const ctx = createCtx();
		let start;
		const pi = { events: bus, on(event, handler) { if (event === "session_start") start = handler; } };
		registerWidgetHost(pi);
		const client = connectWidgetCoordinator(pi, { ctx, clientId: "shared" });
		let disposals = 0;
		let renders = 0;
		const component = {
			render() {
				assert.equal(disposals, 0);
				renders++;
				if (fails) throw new Error("broken");
				return ["shared"];
			},
			invalidate() { assert.equal(disposals, 0); },
			dispose() { disposals++; },
		};
		client.widgets.set("belowEditor", "one", () => component);
		client.widgets.set("belowEditor", "two", () => component);
		start({}, ctx);
		const host = [...ctx.widgets.values()][0].component;
		assert.deepEqual(host.render(80), fails ? [] : ["shared", "shared"]);
		assert.equal(renders, fails ? 1 : 2);
		host.invalidate();
		assert.equal(disposals, fails ? 1 : 0);
		host.dispose();
		host.dispose();
		assert.equal(disposals, 1);
		assert.deepEqual(host.render(80), []);
	}
});

test("fallback keys isolate clients and placements through replacement, fullscreen and attach", () => {
	const bus = createBus();
	const ctx = createCtx();
	const a = connectWidgetCoordinator(createPi(bus, ctx), { ctx, clientId: "a:belowEditor" });
	const b = connectWidgetCoordinator(createPi(bus, ctx), { ctx, clientId: "a" });
	a.widgets.set("aboveEditor", "status", textFactory("a-above"));
	a.widgets.set("belowEditor", "status", textFactory("a-below"));
	b.widgets.set("belowEditor", "status", textFactory("b"));
	b.widgets.set("belowEditor", "aboveEditor:status", textFactory("delimiter"));
	const lines = () => [...ctx.widgets.values()].flatMap((entry) => entry.component.render(80));
	assert.deepEqual(lines(), ["a-above", "a-below", "b", "delimiter"]);
	const rawKeys = [...ctx.widgets.keys()];
	a.widgets.set("belowEditor", "status", textFactory("a-updated"));
	assert.deepEqual([...ctx.widgets.keys()], rawKeys);
	assert.deepEqual(lines(), ["a-above", "a-updated", "b", "delimiter"]);
	a.widgets.remove("aboveEditor", "status");
	assert.deepEqual(lines(), ["a-updated", "b", "delimiter"]);
	const lease = a.fullscreen.acquire();
	assert.deepEqual(lines(), ["b", "delimiter"]);
	lease.release();
	assert.deepEqual(lines(), ["b", "delimiter", "a-updated"]);
	a.dispose();
	assert.deepEqual(lines(), ["b", "delimiter"]);
	const hostCtx = createCtx();
	registerWidgetHost(createPi(bus, hostCtx));
	assert.equal(ctx.widgets.size, 0);
	assert.deepEqual(renderHost(hostCtx), ["b", "delimiter"]);
	b.dispose();
	assert.equal(hostCtx.widgets.size, 0);
});

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

test("fallback activity retries a missed hello without polling", () => {
	const bus = createBus();
	const ctx = createCtx();
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-missed-hello" });
	bus.on(EVENTS.hello, (data) => {
		bus.emit(EVENTS.ready, { protocolVersion: 1, clientId: `host-for-${data.clientId}` });
	});

	client.widgets.set("belowEditor", "status", textFactory("attached"));

	assert.equal(client.mode, "coordinated");
	assert.equal(ctx.widgets.size, 0);
	const registrations = bus.emitted.filter(
		(event) => event.channel === EVENTS.registerWidget && event.data.clientId === "client-missed-hello",
	);
	assert.equal(registrations.length, 1);
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

test("fallback widget updates preserve raw cross-extension order and refresh mounted content", () => {
	const bus = createBus();
	let disposals = 0;
	let invalidations = 0;
	let redraws = 0;
	const lifecycle = [];
	const tui = {
		requestRender() {
			redraws++;
		},
	};
	const ctx = createCtx(tui);
	const a = connect(createPi(bus, ctx), { ctx, clientId: "fallback-order-a" });
	const b = connect(createPi(bus, ctx), { ctx, clientId: "fallback-order-b" });
	const factory = (text) => () => {
		lifecycle.push(`factory:${text}`);
		return {
			render: () => [text],
			invalidate() {
				invalidations++;
			},
			dispose() {
				lifecycle.push(`dispose:${text}`);
				disposals++;
			},
		};
	};

	a.widgets.set("belowEditor", "a", factory("a1"));
	b.widgets.set("belowEditor", "b", textFactory("b1"));
	const rawKeys = [...ctx.widgets.keys()];
	const rawA = [...ctx.widgets.values()][0];
	const mountedA = rawA.component;
	assert.deepEqual(mountedA.render(80), ["a1"]);

	a.widgets.set("belowEditor", "a", factory("a2"));
	a.widgets.set("belowEditor", "a", factory("a3"));

	assert.deepEqual([...ctx.widgets.keys()], rawKeys);
	assert.deepEqual(mountedA.render(80), ["a3"]);
	mountedA.invalidate();
	assert.equal(disposals, 2);
	assert.equal(invalidations, 1);
	assert.equal(redraws, 2);
	assert.deepEqual(lifecycle, ["factory:a1", "dispose:a1", "factory:a2", "dispose:a2", "factory:a3"]);
	assert.equal(ctx.calls.filter((call) => call.factory !== undefined).length, 2);
	a.widgets.remove("belowEditor", "a");
	a.widgets.remove("belowEditor", "a");
	assert.equal(disposals, 3);
});

test("fallback proxy recovers after an out-of-band clear", () => {
	const bus = createBus();
	const ctx = createCtx();
	const client = connect(createPi(bus, ctx), { ctx, clientId: "fallback-recovery" });

	client.widgets.set("belowEditor", "status", textFactory("first"));
	const { key: rawKey, factory: stableFactory } = [...ctx.widgets.values()][0];
	ctx.ui.setWidget(rawKey, textFactory("intruder"), { placement: "aboveEditor" });
	assert.equal(ctx.widgets.has(`belowEditor:${rawKey}`), false);
	assert.equal(ctx.widgets.has(`aboveEditor:${rawKey}`), true);
	ctx.ui.setWidget(rawKey, undefined, { placement: "belowEditor" });
	assert.equal(ctx.widgets.size, 0);

	client.widgets.set("belowEditor", "status", textFactory("recovered"));

	const recovered = ctx.widgets.get(`belowEditor:${rawKey}`);
	assert.ok(recovered);
	assert.equal(recovered.factory, stableFactory);
	assert.deepEqual(recovered.component.render(80), ["recovered"]);
});

test("fallback proxy unmounts once across fullscreen, late attach, and dispose", () => {
	const disposableFactory = (onDispose) => () => ({
		render: () => ["mounted"],
		invalidate() {},
		dispose: onDispose,
	});
	const fullscreenBus = createBus();
	const fullscreenCtx = createCtx();
	const fullscreenClient = connect(createPi(fullscreenBus, fullscreenCtx), { ctx: fullscreenCtx, clientId: "fallback-lifecycle" });
	let fullscreenDisposals = 0;
	fullscreenClient.widgets.set("belowEditor", "status", disposableFactory(() => fullscreenDisposals++));
	const lease = fullscreenClient.fullscreen.acquire();
	assert.equal(fullscreenDisposals, 1);
	lease.release();
	fullscreenClient.dispose();
	fullscreenClient.dispose();
	assert.equal(fullscreenDisposals, 2);

	const attachBus = createBus();
	const attachCtx = createCtx();
	const attachClient = connect(createPi(attachBus, attachCtx), { ctx: attachCtx, clientId: "fallback-attach" });
	let attachDisposals = 0;
	attachClient.widgets.set("belowEditor", "status", disposableFactory(() => attachDisposals++));
	attachBus.emit(EVENTS.ready, { protocolVersion: 1, clientId: "host" });
	attachBus.emit(EVENTS.ready, { protocolVersion: 1, clientId: "host" });
	assert.equal(attachDisposals, 1);
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
	const rawKeys = [...ctx.widgets.keys()];
	assert.equal(rawKeys.length, 2);

	const leaseA = client.fullscreen.acquire();
	assert.equal(ctx.widgets.size, 0);
	const leaseB = client.fullscreen.acquire();
	leaseA.release();
	assert.equal(ctx.widgets.size, 0);
	leaseA.release();
	assert.equal(ctx.widgets.size, 0);
	leaseB.release();
	assert.deepEqual([...ctx.widgets.keys()], rawKeys);

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

test("ui.fullscreen mounts as an overlay before any TUI mode has been captured", async () => {
	const bus = createBus();
	const ctx = createCtx();
	let customOptions;
	ctx.ui.custom = async (_factory, options) => {
		customOptions = options;
		return "result";
	};
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-first-open" });

	await client.ui.fullscreen(() => ({ render: () => [] }));

	assert.deepEqual(customOptions, {
		overlay: true,
		overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%" },
	});
});

test("ui.fullscreen temporarily replaces the fullscreen layout root without overlaying the dashboard", async () => {
	const bus = createBus();
	const ctx = createCtx();
	const priorRoot = { render: () => ["transcript image"] };
	const events = [];
	const tui = {
		mode: "fullscreen",
		layoutRoot: priorRoot,
		setLayoutRoot(root) {
			this.layoutRoot = root;
			events.push(["root", root]);
		},
		requestRender(force) {
			events.push(["redraw", force]);
		},
	};
	let dashboardRenders = 0;
	const dashboardInputs = [];
	let dashboardInvalidations = 0;
	let dashboardDisposals = 0;
	const dashboard = {
		focused: false,
		wantsKeyRelease: false,
		render() {
			dashboardRenders++;
			return ["dashboard"];
		},
		handleInput(data) {
			dashboardInputs.push(data);
		},
		invalidate() {
			dashboardInvalidations++;
		},
		dispose() {
			dashboardDisposals++;
		},
	};
	ctx.ui.custom = async (factory, options) => {
		assert.equal(options.overlay, true);
		const mounted = factory(tui, {}, {}, () => {});
		assert.equal(tui.layoutRoot, dashboard);
		assert.deepEqual(tui.layoutRoot.render(80), ["dashboard"]);
		assert.deepEqual(mounted.render(80), []);
		mounted.handleInput("down");
		mounted.invalidate();
		mounted.focused = true;
		assert.equal(dashboard.focused, true);
		dashboard.focused = false;
		assert.equal(mounted.focused, false);
		assert.equal(mounted.wantsKeyRelease, false);
		dashboard.wantsKeyRelease = true;
		assert.equal(mounted.wantsKeyRelease, true);
		mounted.dispose();
		assert.equal(dashboardRenders, 1);
		return "result";
	};
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-layout-root" });

	assert.equal(await client.ui.fullscreen(() => dashboard), "result");
	assert.equal(tui.layoutRoot, priorRoot);
	assert.deepEqual(events, [
		["root", dashboard],
		["redraw", true],
		["root", priorRoot],
		["redraw", true],
	]);
	assert.deepEqual(dashboardInputs, ["down"]);
	assert.equal(dashboardInvalidations, 1);
	assert.equal(dashboardDisposals, 1);
});

test("ui.fullscreen restores the fullscreen layout root before forwarding done", async () => {
	const bus = createBus();
	const ctx = createCtx();
	const events = [];
	const priorRoot = {
		render: () => ["transcript"],
		invalidate() {
			events.push(["invalidate", priorRoot]);
		},
	};
	const tui = {
		mode: "fullscreen",
		layoutRoot: priorRoot,
		setLayoutRoot(root) {
			this.layoutRoot = root;
			events.push(["root", root]);
		},
		requestRender(force) {
			events.push(["redraw", force]);
		},
	};
	const dashboard = { render: () => ["dashboard"] };
	let finish;
	let rootWhenDone;
	ctx.ui.custom = (factory) => new Promise((resolve) => {
		factory(tui, {}, {}, (result) => {
			rootWhenDone = tui.layoutRoot;
			resolve(result);
		});
		assert.equal(tui.layoutRoot, dashboard);
		finish();
	});
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-restore-before-done" });

	assert.equal(await client.ui.fullscreen((_tui, _theme, _keybindings, done) => {
		finish = () => done("result");
		return dashboard;
	}), "result");
	assert.equal(rootWhenDone, priorRoot);
	assert.deepEqual(events, [
		["root", dashboard],
		["redraw", true],
		["invalidate", priorRoot],
		["root", priorRoot],
		["redraw", true],
	]);
});

test("ui.fullscreen restores the exact fullscreen layout root when the host custom UI rejects", async () => {
	const bus = createBus();
	const ctx = createCtx();
	const events = [];
	const priorRoot = {
		render: () => ["transcript"],
		invalidate() {
			events.push(["invalidate", priorRoot]);
		},
	};
	const tui = {
		mode: "fullscreen",
		layoutRoot: priorRoot,
		setLayoutRoot(root) {
			this.layoutRoot = root;
			events.push(["root", root]);
		},
		requestRender(force) {
			events.push(["redraw", force]);
		},
	};
	const dashboard = { render: () => ["dashboard"] };
	ctx.ui.custom = async (factory) => {
		factory(tui, {}, {}, () => {});
		throw new Error("custom failed");
	};
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-layout-root-error" });

	await assert.rejects(() => client.ui.fullscreen(() => dashboard), /custom failed/);
	assert.equal(tui.layoutRoot, priorRoot);
	assert.deepEqual(events, [
		["root", dashboard],
		["redraw", true],
		["invalidate", priorRoot],
		["root", priorRoot],
		["redraw", true],
	]);
});

test("ui.fullscreen swaps in a dashboard returned by an async factory", async () => {
	const bus = createBus();
	const ctx = createCtx();
	const priorRoot = { render: () => ["transcript"] };
	const tui = {
		mode: "fullscreen",
		layoutRoot: priorRoot,
		setLayoutRoot(root) {
			this.layoutRoot = root;
		},
		requestRender() {},
	};
	const dashboard = { render: () => ["dashboard"] };
	ctx.ui.custom = async (factory) => {
		const mounted = await factory(tui, {}, {}, () => {});
		assert.equal(tui.layoutRoot, dashboard);
		assert.deepEqual(mounted.render(80), []);
		return "result";
	};
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-async-layout-root" });

	assert.equal(await client.ui.fullscreen(async () => dashboard), "result");
	assert.equal(tui.layoutRoot, priorRoot);
});

test("ui.fullscreen does not mount an async dashboard after done closes the custom UI", async () => {
	const bus = createBus();
	const ctx = createCtx();
	const priorRoot = { render: () => ["transcript"] };
	const tui = {
		mode: "fullscreen",
		layoutRoot: priorRoot,
		setLayoutRoot(root) {
			this.layoutRoot = root;
		},
		requestRender() {},
	};
	const dashboard = { render: () => ["dashboard"] };
	let settleFactory;
	let factorySettled;
	ctx.ui.custom = (factory) => new Promise((resolve) => {
		factorySettled = factory(tui, {}, {}, resolve);
	});
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-async-done-first" });

	const result = client.ui.fullscreen(async (_tui, _theme, _keybindings, done) => {
		done("result");
		await new Promise((resolve) => {
			settleFactory = resolve;
		});
		return dashboard;
	});

	assert.equal(await result, "result");
	assert.equal(tui.layoutRoot, priorRoot);
	settleFactory();
	await factorySettled;
	assert.equal(tui.layoutRoot, priorRoot);
});

test("ui.fullscreen keeps the overlay fallback when the prior layout root cannot be captured", async () => {
	const bus = createBus();
	const ctx = createCtx();
	let rootSet = false;
	let invalidations = 0;
	const tui = {
		mode: "fullscreen",
		setLayoutRoot() {
			rootSet = true;
		},
	};
	const dashboard = {
		render: () => ["dashboard"],
		invalidate() {
			invalidations++;
		},
	};
	ctx.ui.custom = async (factory) => {
		const mounted = factory(tui, {}, {}, () => {});
		assert.equal(mounted, dashboard);
		return "result";
	};
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-no-readable-root" });

	assert.equal(await client.ui.fullscreen(() => dashboard), "result");
	assert.equal(rootSet, false);
	assert.equal(invalidations, 0);
});

test("ui.fullscreen preserves the editor-slot mount after regular TUI mode is captured", async () => {
	const bus = createBus();
	let customOptions = "not-called";
	let invalidations = 0;
	let rootSet = false;
	const priorRoot = {
		render: () => ["transcript"],
		invalidate() {
			invalidations++;
		},
	};
	const tui = {
		mode: "regular",
		layoutRoot: priorRoot,
		setLayoutRoot() {
			rootSet = true;
		},
	};
	const ctx = createCtx(tui);
	const dashboard = { render: () => ["dashboard"] };
	ctx.ui.custom = async (factory, options) => {
		customOptions = options;
		assert.equal(factory(tui, {}, {}, () => {}), dashboard);
		return "result";
	};
	const client = connect(createPi(bus, ctx), { ctx, clientId: "client-ui-regular" });
	client.widgets.set("belowEditor", "capture", textFactory("capture"));
	const widget = [...ctx.widgets.values()][0];
	assert.ok(widget);
	widget.component.render(80);

	await client.ui.fullscreen(() => dashboard);

	assert.equal(customOptions, undefined);
	assert.equal(rootSet, false);
	assert.equal(invalidations, 0);
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
