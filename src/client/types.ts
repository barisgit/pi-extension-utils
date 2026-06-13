import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RemindersClient } from "../reminders/client.ts";
import type { UiClient } from "../ui/client.ts";
import type { FullscreenClient, WidgetsClient } from "../widgets/client.ts";

export interface UtilsClientOptions {
	ctx: ExtensionContext;
	clientId?: string;
}

export interface UtilsClient {
	readonly clientId: string;
	readonly mode: "fallback" | "coordinated";
	widgets: WidgetsClient;
	fullscreen: FullscreenClient;
	ui: UiClient;
	reminders: RemindersClient;
	dispose(): void;
}
