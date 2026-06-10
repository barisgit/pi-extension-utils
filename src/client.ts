import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WidgetFactory, WidgetPlacement } from "./protocol.ts";
import {
	basePayload,
	EVENTS,
	PROTOCOL_VERSION,
	type ReadyPayload,
} from "./protocol.ts";

export interface UtilsClientOptions {
	ctx: ExtensionContext;
	clientId?: string;
}

export interface WidgetSetOptions {
	order?: number;
}

export interface FullscreenLease {
	release(): void;
}

export interface UtilsClient {
	readonly clientId: string;
	readonly mode: "fallback" | "coordinated";
	widgets: {
		set(placement: WidgetPlacement, key: string, factory: WidgetFactory, opts?: WidgetSetOptions): void;
		remove(placement: WidgetPlacement, key: string): void;
	};
	fullscreen: {
		acquire(): FullscreenLease;
	};
	dispose(): void;
}

interface WidgetRecord {
	placement: WidgetPlacement;
	key: string;
	factory: WidgetFactory;
	order: number;
}

let nextClientId = 1;
let nextLeaseId = 1;

export function connect(pi: ExtensionAPI, opts: UtilsClientOptions): UtilsClient {
	const clientId = opts.clientId ?? `client-${process.pid}-${Date.now()}-${nextClientId++}`;
	const widgets = new Map<string, WidgetRecord>();
	const leases = new Set<string>();
	let disposed = false;
	let coordinated = false;

	const widgetId = (placement: WidgetPlacement, key: string) => `${placement}:${key}`;

	function emitRegister(record: WidgetRecord): void {
		pi.events.emit(EVENTS.registerWidget, {
			...basePayload(clientId),
			placement: record.placement,
			key: record.key,
			order: record.order,
			factory: record.factory,
		});
	}

	function clearFallback(record: WidgetRecord): void {
		opts.ctx.ui.setWidget(record.key, undefined, { placement: record.placement });
	}

	function attach(): void {
		if (disposed || coordinated) return;
		coordinated = true;
		for (const record of widgets.values()) {
			clearFallback(record);
			emitRegister(record);
		}
		for (const token of leases) {
			pi.events.emit(EVENTS.fullscreenAcquire, { ...basePayload(clientId), token });
		}
	}

	const offReady = pi.events.on(EVENTS.ready, (data: unknown) => {
		if (!isReadyPayload(data)) return;
		attach();
	});

	pi.events.emit(EVENTS.hello, basePayload(clientId));

	const client: UtilsClient = {
		clientId,
		get mode() {
			return coordinated ? "coordinated" : "fallback";
		},
		widgets: {
			set(placement, key, factory, setOpts = {}) {
				if (disposed) return;
				const record = { placement, key, factory, order: setOpts.order ?? 0 };
				widgets.set(widgetId(placement, key), record);
				if (coordinated) {
					emitRegister(record);
				} else {
					opts.ctx.ui.setWidget(key, factory, { placement });
				}
			},
			remove(placement, key) {
				const id = widgetId(placement, key);
				const record = widgets.get(id);
				if (!record) return;
				widgets.delete(id);
				if (coordinated) {
					pi.events.emit(EVENTS.unregisterWidget, { ...basePayload(clientId), placement, key });
				} else {
					clearFallback(record);
				}
			},
		},
		fullscreen: {
			acquire() {
				const token = `${clientId}-lease-${nextLeaseId++}`;
				let released = false;
				leases.add(token);
				if (coordinated) {
					pi.events.emit(EVENTS.fullscreenAcquire, { ...basePayload(clientId), token });
				}
				return {
					release() {
						if (released) return;
						released = true;
						leases.delete(token);
						if (coordinated && !disposed) {
							pi.events.emit(EVENTS.fullscreenRelease, { ...basePayload(clientId), token });
						}
					},
				};
			},
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			offReady();
			if (coordinated) {
				pi.events.emit(EVENTS.unregisterWidget, { ...basePayload(clientId), all: true });
				for (const token of leases) {
					pi.events.emit(EVENTS.fullscreenRelease, { ...basePayload(clientId), token });
				}
			} else {
				for (const record of widgets.values()) clearFallback(record);
			}
			leases.clear();
			widgets.clear();
		},
	};

	return client;
}

function isReadyPayload(data: unknown): data is ReadyPayload {
	if (!data || typeof data !== "object") return false;
	const payload = data as Partial<ReadyPayload>;
	return typeof payload.protocolVersion === "number" && payload.protocolVersion <= PROTOCOL_VERSION && typeof payload.clientId === "string";
}
