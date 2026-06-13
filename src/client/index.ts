import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRemindersClient } from "../reminders/client.ts";
import { createUiClient } from "../ui/client.ts";
import { connectWidgetCoordinator } from "../widgets/client.ts";
import type { UtilsClient, UtilsClientOptions } from "./types.ts";

export type { UtilsClient, UtilsClientOptions } from "./types.ts";
export type { RemindersClient } from "../reminders/client.ts";
export type { FullscreenComponentFactory, UiClient } from "../ui/client.ts";
export type { FullscreenClient, FullscreenLease, WidgetsClient, WidgetSetOptions } from "../widgets/client.ts";

let nextClientId = 1;

export function connect(pi: ExtensionAPI, opts: UtilsClientOptions): UtilsClient {
	const clientId = opts.clientId ?? `client-${process.pid}-${Date.now()}-${nextClientId++}`;
	let disposed = false;
	const coordinator = connectWidgetCoordinator(pi, { ctx: opts.ctx, clientId });
	return {
		clientId,
		get mode() {
			return coordinator.mode;
		},
		widgets: coordinator.widgets,
		fullscreen: coordinator.fullscreen,
		ui: createUiClient(coordinator.fullscreen, opts.ctx),
		reminders: createRemindersClient(pi, () => disposed),
		dispose() {
			if (disposed) return;
			disposed = true;
			coordinator.dispose();
		},
	};
}
