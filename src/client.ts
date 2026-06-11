import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WidgetFactory, WidgetPlacement } from "./protocol.ts";
import {
	REMINDER_ANNOUNCE_NOW_EVENT,
	REMINDER_CLEAR_SOURCE_EVENT,
	REMINDER_LIST_EVENT,
	REMINDER_REMOVE_EVENT,
	REMINDER_UPSERT_EVENT,
	type ReminderAnnounceNowRequest,
	type ReminderIntent,
	type ReminderSnapshot,
} from "./reminders/types.ts";
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

/**
 * Factory signature accepted by `ctx.ui.custom`. Typed structurally so the
 * client does not depend on pi-tui types directly.
 */
export type FullscreenComponentFactory<T> = (
	tui: unknown,
	theme: unknown,
	keybindings: unknown,
	done: (result: T) => void,
) => unknown;

export interface RemindersClient {
	upsert(intent: ReminderIntent): void;
	remove(source: string, key: string): void;
	clearSource(source: string): void;
	announceNow(payload?: ReminderAnnounceNowRequest): void;
	list(source?: string): Promise<ReminderSnapshot>;
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
	ui: {
		/**
		 * Run a full-screen custom UI: acquires a fullscreen lease (blanking
		 * coordinated widgets), shows the component via `ctx.ui.custom`, and
		 * releases the lease in a finally — even if the component throws.
		 */
		fullscreen<T>(factory: FullscreenComponentFactory<T>): Promise<T>;
	};
	reminders: RemindersClient;
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

	function restoreFallback(record: WidgetRecord): void {
		opts.ctx.ui.setWidget(record.key, record.factory, { placement: record.placement });
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
				} else if (leases.size === 0) {
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
				const wasFallbackVisible = !coordinated && leases.size === 0;
				leases.add(token);
				if (coordinated) {
					pi.events.emit(EVENTS.fullscreenAcquire, { ...basePayload(clientId), token });
				} else if (wasFallbackVisible) {
					for (const record of widgets.values()) clearFallback(record);
				}
				return {
					release() {
						if (released) return;
						released = true;
						leases.delete(token);
						if (coordinated && !disposed) {
							pi.events.emit(EVENTS.fullscreenRelease, { ...basePayload(clientId), token });
						} else if (!disposed && leases.size === 0) {
							for (const record of widgets.values()) restoreFallback(record);
						}
					},
				};
			},
		},
		ui: {
			async fullscreen<T>(factory: FullscreenComponentFactory<T>): Promise<T> {
				const lease = client.fullscreen.acquire();
				try {
					const ui = opts.ctx.ui as { custom<R>(f: FullscreenComponentFactory<R>): Promise<R> };
					return await ui.custom(factory);
				} finally {
					lease.release();
				}
			},
		},
		reminders: {
			upsert(intent) {
				if (disposed) return;
				pi.events.emit(REMINDER_UPSERT_EVENT, intent);
			},
			remove(source, key) {
				if (disposed) return;
				pi.events.emit(REMINDER_REMOVE_EVENT, { source, id: key });
			},
			clearSource(source) {
				if (disposed) return;
				pi.events.emit(REMINDER_CLEAR_SOURCE_EVENT, { source });
			},
			announceNow(payload = {}) {
				if (disposed) return;
				pi.events.emit(REMINDER_ANNOUNCE_NOW_EVENT, payload);
			},
			list(source) {
				if (disposed) return Promise.resolve(emptyReminderSnapshot());
				let settled = false;
				let resolveSnapshot!: (snapshot: ReminderSnapshot) => void;
				let rejectSnapshot!: (error: unknown) => void;
				const promise = new Promise<ReminderSnapshot>((resolve, reject) => {
					resolveSnapshot = (snapshot) => {
						settled = true;
						resolve(snapshot);
					};
					rejectSnapshot = (error) => {
						settled = true;
						reject(error);
					};
				});
				pi.events.emit(REMINDER_LIST_EVENT, { source, resolve: resolveSnapshot, reject: rejectSnapshot });
				if (!settled) resolveSnapshot(emptyReminderSnapshot());
				return promise;
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

function emptyReminderSnapshot(): ReminderSnapshot {
	return { reminders: [], count: 0 };
}
