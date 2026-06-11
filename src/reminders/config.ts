import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface RemindersConfig {
	debugShowAllInTui?: boolean;
}

export function configPath(cwd: string): string {
	return join(cwd, ".pi", "reminders", "reminders-config.json");
}

export function loadConfig(cwd: string): RemindersConfig {
	try {
		const parsed = JSON.parse(readFileSync(configPath(cwd), "utf8"));
		if (!parsed || typeof parsed !== "object") return {};
		return {
			debugShowAllInTui: typeof parsed.debugShowAllInTui === "boolean" ? parsed.debugShowAllInTui : undefined,
		};
	} catch {
		return {};
	}
}

export function saveConfig(config: RemindersConfig, cwd: string): void {
	const filePath = configPath(cwd);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(config, null, 2));
}
