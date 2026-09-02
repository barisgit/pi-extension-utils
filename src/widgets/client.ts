import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TuiModeCapture } from "../ui/client.ts";
import { basePayload, EVENTS, PROTOCOL_VERSION, type ReadyPayload, type WidgetFactory, type WidgetPlacement } from "./protocol.ts";

export interface WidgetSetOptions {
	order?: number;
}

export interface FullscreenLease {
	release(): void;
}

export interface WidgetsClient {
	set(placement: WidgetPlacement, key: string, factory: WidgetFactory, opts?: WidgetSetOptions): void;
	remove(placement: WidgetPlacement, key: string): void;
}

export interface FullscreenClient {
	acquire(): FullscreenLease;
}

export interface WidgetCoordinatorClient {
	readonly mode: "fallback" | "coordinated";
	widgets: WidgetsClient;
	fullscreen: FullscreenClient;
	dispose(): void;
}

interface WidgetCoordinatorClientOptions {
	ctx: ExtensionContext;
	clientId: string;
	/** Optional shared TUI-mode capture fed by every widget factory invocation. */
	tui?: TuiModeCapture;
}

interface WidgetRecord {
	placement: WidgetPlacement;
	key: string;
	factory: WidgetFactory;
	fallbackFactory: WidgetFactory;
	fallbackMount?: FallbackMount;
	order: number;
}

interface FallbackTui {
	requestRender?(force?: boolean): void;
}

interface FallbackMount {
	tui: Parameters<WidgetFactory>[0];
	theme: Parameters<WidgetFactory>[1];
	component: ReturnType<WidgetFactory>;
	disposed: boolean;
}

let nextLeaseId = 1;

function withTuiCapture(factory: WidgetFactory, capture: TuiModeCapture): WidgetFactory {
	return (tui, theme) => {
		capture.noteTui(tui);
		return factory(tui, theme);
	};
}

export function connectWidgetCoordinator(pi: ExtensionAPI, opts: WidgetCoordinatorClientOptions): WidgetCoordinatorClient {
	const { clientId } = opts;
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

	function emitHello(): void {
		pi.events.emit(EVENTS.hello, basePayload(clientId));
	}

	function createWidgetRecord(placement: WidgetPlacement, key: string, factory: WidgetFactory, order: number): WidgetRecord {
		const record: WidgetRecord = {
			placement,
			key,
			factory,
			fallbackFactory: (tui, theme) => {
				const mount: FallbackMount = {
					tui,
					theme,
					component: record.factory(tui, theme),
					disposed: false,
				};
				record.fallbackMount = mount;
				return {
					render: (width: number) => (mount.disposed ? [] : mount.component.render(width)),
					invalidate: () => {
						if (!mount.disposed) mount.component.invalidate?.();
					},
					dispose: () => {
						if (mount.disposed) return;
						mount.disposed = true;
						mount.component.dispose?.();
						if (record.fallbackMount === mount) record.fallbackMount = undefined;
					},
				};
			},
			order,
		};
		return record;
	}

	function updateFallback(record: WidgetRecord): void {
		const mount = record.fallbackMount;
		if (!mount || mount.disposed) {
			restoreFallback(record);
			return;
		}
		mount.disposed = true;
		mount.component.dispose?.();
		mount.component = record.factory(mount.tui, mount.theme);
		mount.disposed = false;
		(mount.tui as FallbackTui | null | undefined)?.requestRender?.();
	}

	function clearFallback(record: WidgetRecord): void {
		opts.ctx.ui.setWidget(record.key, undefined, { placement: record.placement });
	}

	function restoreFallback(record: WidgetRecord): void {
		opts.ctx.ui.setWidget(record.key, record.fallbackFactory, { placement: record.placement });
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

	emitHello();

	const fullscreen: FullscreenClient = {
		acquire(): FullscreenLease {
			const token = `${clientId}-lease-${nextLeaseId++}`;
			let released = false;
			const wasFallbackVisible = !coordinated && leases.size === 0;
			leases.add(token);
			if (coordinated) {
				pi.events.emit(EVENTS.fullscreenAcquire, { ...basePayload(clientId), token });
			} else if (wasFallbackVisible) {
				for (const record of widgets.values()) clearFallback(record);
			}
			if (!coordinated) emitHello();
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
	};

	return {
		get mode() {
			return coordinated ? "coordinated" : "fallback";
		},
		widgets: {
			set(placement: WidgetPlacement, key: string, factory: WidgetFactory, setOpts: WidgetSetOptions = {}) {
				if (disposed) return;
				const id = widgetId(placement, key);
				const wrappedFactory = opts.tui ? withTuiCapture(factory, opts.tui) : factory;
				let record = widgets.get(id);
				const isNew = !record;
				if (record) {
					record.factory = wrappedFactory;
					record.order = setOpts.order ?? 0;
				} else {
					record = createWidgetRecord(placement, key, wrappedFactory, setOpts.order ?? 0);
					widgets.set(id, record);
				}
				if (coordinated) {
					emitRegister(record);
				} else if (leases.size === 0) {
					if (isNew) {
						restoreFallback(record);
					} else {
						updateFallback(record);
					}
				}
				if (!coordinated) emitHello();
			},
			remove(placement: WidgetPlacement, key: string) {
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
		fullscreen,
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
}

function isReadyPayload(data: unknown): data is ReadyPayload {
	if (!data || typeof data !== "object") return false;
	const payload = data as Partial<ReadyPayload>;
	return typeof payload.protocolVersion === "number" && payload.protocolVersion <= PROTOCOL_VERSION && typeof payload.clientId === "string";
}
