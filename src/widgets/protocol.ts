import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PROTOCOL_VERSION = 1;
export const EVENT_PREFIX = "pi-extension-utils";

export const HELLO_EVENT = `${EVENT_PREFIX}:hello`;
export const READY_EVENT = `${EVENT_PREFIX}:ready`;
export const REGISTER_WIDGET_EVENT = `${EVENT_PREFIX}:register-widget`;
export const UNREGISTER_WIDGET_EVENT = `${EVENT_PREFIX}:unregister-widget`;
export const FULLSCREEN_ACQUIRE_EVENT = `${EVENT_PREFIX}:fullscreen-acquire`;
export const FULLSCREEN_RELEASE_EVENT = `${EVENT_PREFIX}:fullscreen-release`;

export const EVENTS = {
	hello: HELLO_EVENT,
	ready: READY_EVENT,
	registerWidget: REGISTER_WIDGET_EVENT,
	unregisterWidget: UNREGISTER_WIDGET_EVENT,
	fullscreenAcquire: FULLSCREEN_ACQUIRE_EVENT,
	fullscreenRelease: FULLSCREEN_RELEASE_EVENT,
} as const;

export type WidgetPlacement = "aboveEditor" | "belowEditor";
export type WidgetFactory = NonNullable<Parameters<ExtensionContext["ui"]["setWidget"]>[1]>;

export interface ProtocolPayload {
	protocolVersion: number;
	clientId: string;
}

export interface HelloPayload extends ProtocolPayload {}
export interface ReadyPayload extends ProtocolPayload {}

export interface RegisterWidgetPayload extends ProtocolPayload {
	placement: WidgetPlacement;
	key: string;
	order: number;
	factory: WidgetFactory;
}

export interface UnregisterWidgetPayload extends ProtocolPayload {
	placement?: WidgetPlacement;
	key?: string;
	all?: boolean;
}

export interface FullscreenAcquirePayload extends ProtocolPayload {
	token: string;
}

export interface FullscreenReleasePayload extends ProtocolPayload {
	token: string;
}

export function basePayload(clientId: string): ProtocolPayload {
	return { protocolVersion: PROTOCOL_VERSION, clientId };
}
