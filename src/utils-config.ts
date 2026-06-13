import { Type, type Static } from "typebox";
import { defineConfig } from "./config/index.ts";
import { loggingConfigSchema } from "./logger/config.ts";
import { remindersConfigSchema } from "./reminders/config.ts";

export const utilsConfigSchema = Type.Object({
	logging: loggingConfigSchema,
	reminders: remindersConfigSchema,
});

export type UtilsConfig = Static<typeof utilsConfigSchema>;

export const DEFAULT_UTILS_CONFIG: UtilsConfig = {
	logging: {
		level: "info",
		maxFiles: 3,
		maxBytes: 1048576,
	},
	reminders: {
		debugShowAllInTui: false,
	},
};

export const utilsConfig = defineConfig({
	name: "utils",
	schema: utilsConfigSchema,
});

let warnedAboutInvalidConfig = false;

export function readUtilsConfigOrDefaults(mode: "get" | "reload" = "get"): UtilsConfig {
	try {
		return mode === "reload" ? utilsConfig.reload() : utilsConfig.get();
	} catch (error) {
		if (!warnedAboutInvalidConfig) {
			warnedAboutInvalidConfig = true;
			console.warn("pi-extension-utils: invalid utils config; using defaults", error);
		}
		return cloneDefaultUtilsConfig();
	}
}

function cloneDefaultUtilsConfig(): UtilsConfig {
	return JSON.parse(JSON.stringify(DEFAULT_UTILS_CONFIG));
}
