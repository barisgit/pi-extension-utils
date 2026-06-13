import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerReminderHost } from "./src/reminders/host.ts";
import { registerWidgetHost } from "./src/widgets/host.ts";

export default function (pi: ExtensionAPI) {
	registerHost("reminders", () => registerReminderHost(pi));
	registerHost("widgets", () => registerWidgetHost(pi));
}

function registerHost(name: string, register: () => void): void {
	try {
		register();
	} catch (error) {
		console.warn(`pi-extension-utils: failed to register ${name} host`, error);
	}
}
