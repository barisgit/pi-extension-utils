import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	basePayload,
	EVENTS,
	PROTOCOL_VERSION,
	type FullscreenAcquirePayload,
	type FullscreenReleasePayload,
	type HelloPayload,
	type RegisterWidgetPayload,
	type UnregisterWidgetPayload,
	type WidgetFactory,
	type WidgetPlacement,
} from "./protocol.ts";

const HOST_CLIENT_ID = "pi-extension-utils-host";
const HOST_WIDGET_PREFIX = "pi-extension-utils";
const PLACEMENTS: WidgetPlacement[] = ["aboveEditor", "belowEditor"];

interface WidgetRecord {
	clientId: string;
	key: string;
	order: number;
	seq: number;
	factory: WidgetFactory;
}

interface FullscreenLease {
	clientId: string;
	token: string;
}

export function registerWidgetHost(pi: ExtensionAPI): void {
	const widgets = new Map<WidgetPlacement, WidgetRecord[]>();
	const fullscreenStack: FullscreenLease[] = [];
	let seq = 0;
	let currentCtx: ExtensionContext | undefined;

	for (const placement of PLACEMENTS) widgets.set(placement, []);

	function setHostWidget(placement: WidgetPlacement): void {
		if (!currentCtx) return;
		const records = sortedWidgets(placement);
		const hidden = fullscreenStack.length > 0;
		if (records.length === 0 && !hidden) {
			currentCtx.ui.setWidget(hostKey(placement), undefined, { placement });
			return;
		}
		currentCtx.ui.setWidget(hostKey(placement), (tui, theme) => createHostComponent(tui, theme, records, hidden), { placement });
	}

	function rerenderAll(): void {
		for (const placement of PLACEMENTS) setHostWidget(placement);
	}

	pi.events.on(EVENTS.hello, (data) => {
		const payload = readPayload<HelloPayload>(data, "hello");
		if (!payload) return;
		pi.events.emit(EVENTS.ready, basePayload(HOST_CLIENT_ID));
	});

	pi.events.on(EVENTS.registerWidget, (data) => {
		const payload = readPayload<RegisterWidgetPayload>(data, "register-widget");
		if (!payload || !isPlacement(payload.placement) || typeof payload.key !== "string" || typeof payload.order !== "number" || typeof payload.factory !== "function") {
			warnDrop("register-widget", data);
			return;
		}
		const records = widgets.get(payload.placement)!;
		const existing = records.find((record) => record.clientId === payload.clientId && record.key === payload.key);
		if (existing) {
			existing.order = payload.order;
			existing.factory = payload.factory;
		} else {
			records.push({ clientId: payload.clientId, key: payload.key, order: payload.order, factory: payload.factory, seq: seq++ });
		}
		setHostWidget(payload.placement);
	});

	pi.events.on(EVENTS.unregisterWidget, (data) => {
		const payload = readPayload<UnregisterWidgetPayload>(data, "unregister-widget");
		if (!payload) return;
		if (payload.all) {
			removeClient(payload.clientId);
			rerenderAll();
			return;
		}
		if (!isPlacement(payload.placement) || typeof payload.key !== "string") {
			warnDrop("unregister-widget", data);
			return;
		}
		const records = widgets.get(payload.placement)!;
		widgets.set(payload.placement, records.filter((record) => record.clientId !== payload.clientId || record.key !== payload.key));
		setHostWidget(payload.placement);
	});

	pi.events.on(EVENTS.fullscreenAcquire, (data) => {
		const payload = readPayload<FullscreenAcquirePayload>(data, "fullscreen-acquire");
		if (!payload || typeof payload.token !== "string") {
			warnDrop("fullscreen-acquire", data);
			return;
		}
		if (!fullscreenStack.some((lease) => lease.token === payload.token)) {
			fullscreenStack.push({ clientId: payload.clientId, token: payload.token });
			rerenderAll();
		}
	});

	pi.events.on(EVENTS.fullscreenRelease, (data) => {
		const payload = readPayload<FullscreenReleasePayload>(data, "fullscreen-release");
		if (!payload || typeof payload.token !== "string") {
			warnDrop("fullscreen-release", data);
			return;
		}
		const before = fullscreenStack.length;
		for (let index = fullscreenStack.length - 1; index >= 0; index--) {
			if (fullscreenStack[index].token === payload.token) fullscreenStack.splice(index, 1);
		}
		if (fullscreenStack.length !== before) rerenderAll();
	});

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		rerenderAll();
		pi.events.emit(EVENTS.ready, basePayload(HOST_CLIENT_ID));
	});

	pi.events.emit(EVENTS.ready, basePayload(HOST_CLIENT_ID));

	function removeClient(clientId: string): void {
		for (const placement of PLACEMENTS) {
			widgets.set(placement, widgets.get(placement)!.filter((record) => record.clientId !== clientId));
		}
		for (let index = fullscreenStack.length - 1; index >= 0; index--) {
			if (fullscreenStack[index].clientId === clientId) fullscreenStack.splice(index, 1);
		}
	}

	function sortedWidgets(placement: WidgetPlacement): WidgetRecord[] {
		return [...widgets.get(placement)!].sort((a, b) => a.order - b.order || a.seq - b.seq);
	}
}

function createHostComponent(tui: Parameters<WidgetFactory>[0], theme: Parameters<WidgetFactory>[1], records: WidgetRecord[], hidden: boolean): ReturnType<WidgetFactory> {
	const components = hidden ? [] : records.map((record) => record.factory(tui, theme));
	return {
		render(width) {
			return components.flatMap((component) => component.render(width));
		},
		invalidate() {
			for (const component of components) component.invalidate();
		},
	};
}

function hostKey(placement: WidgetPlacement): string {
	return `${HOST_WIDGET_PREFIX}-${placement}`;
}

function readPayload<T extends { protocolVersion: number; clientId: string }>(data: unknown, eventName: string): T | undefined {
	if (!data || typeof data !== "object") {
		warnDrop(eventName, data);
		return undefined;
	}
	const payload = data as Partial<T>;
	if (typeof payload.protocolVersion !== "number" || payload.protocolVersion > PROTOCOL_VERSION || typeof payload.clientId !== "string") {
		warnDrop(eventName, data);
		return undefined;
	}
	return payload as T;
}

function isPlacement(value: unknown): value is WidgetPlacement {
	return value === "aboveEditor" || value === "belowEditor";
}

function warnDrop(eventName: string, data: unknown): void {
	console.warn(`pi-extension-utils: dropping invalid ${eventName} payload`, data);
}
