import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { readUtilsConfigOrDefaults, utilsConfig } from "../utils-config.ts";
import type { RemindersConfig } from "./config.ts";
import { writeReminderDiagnostic } from "./debug.ts";
import { ReminderManager } from "./manager.ts";
import {
	DEBUG_REMINDER_SOURCE,
	LEGACY_REMINDER_MESSAGE_CUSTOM_TYPE,
	REMINDER_ANNOUNCE_NOW_EVENT,
	REMINDER_CLEAR_SOURCE_EVENT,
	REMINDER_LIST_EVENT,
	REMINDER_MESSAGE_CUSTOM_TYPE,
	REMINDER_REMOVE_EVENT,
	REMINDER_UPSERT_EVENT,
} from "./types.ts";
import type {
	ReminderAnnounceNowRequest,
	ReminderClearSourceRequest,
	ReminderIntent,
	ReminderListRequest,
	ReminderRemoveRequest,
} from "./types.ts";

interface ExtensionLikeContext {
	model?: { api?: string; provider?: string };
	sessionManager?: {
		getSessionId?: () => string;
		getCwd?: () => string;
	};
}

interface ReminderMessageDetails {
	reminderCount?: number;
	sources?: string[];
	displayText?: string;
}

interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
}

/** Register the shared reminder host hooks and event listeners. */
export function registerReminderHost(
	pi: ExtensionAPI,
	manager = new ReminderManager(),
): ReminderManager {
	const eventBus = pi.events as any;
	let cfg: RemindersConfig = readUtilsConfigOrDefaults("reload").reminders;

	const refreshConfig = () => {
		cfg = readUtilsConfigOrDefaults("reload").reminders;
	};

	const debugShowAllInTui = () => isDebugModeEnabled(cfg);

	writeReminderDiagnostic({
		event: "reminder_extension_init",
	});
	writeReminderDiagnostic({
		event: "reminder_extension_register_start",
	});

	eventBus.on(REMINDER_UPSERT_EVENT, (payload: unknown) => {
		if (isRecord(payload)) manager.upsert(payload as ReminderIntent);
	});

	eventBus.on(REMINDER_REMOVE_EVENT, (payload: unknown) => {
		if (isRecord(payload)) manager.remove(payload as ReminderRemoveRequest);
	});

	eventBus.on(REMINDER_CLEAR_SOURCE_EVENT, (payload: unknown) => {
		if (isRecord(payload)) manager.clearSource(payload as ReminderClearSourceRequest);
	});

	eventBus.on(REMINDER_ANNOUNCE_NOW_EVENT, (payload: unknown) => {
		manager.forceAnnounce(isRecord(payload) ? payload as ReminderAnnounceNowRequest : {});
	});

	eventBus.on(REMINDER_LIST_EVENT, (payload: unknown) => {
		if (isRecord(payload) && typeof payload.resolve === "function") {
			handleListRequest(manager, payload as ReminderListRequest);
		}
	});

	if (typeof (pi as any).registerMessageRenderer === "function") {
		const renderer = (message: any, _options: unknown, theme: any) => {
			const details = isRecord(message.details) ? message.details as ReminderMessageDetails : undefined;
			const content = typeof details?.displayText === "string"
				? details.displayText
				: stripSystemReminderWrapper(extractTextContent(message.content));
			return new SystemReminderComponent(content, details, theme);
		};
		(pi as any).registerMessageRenderer(REMINDER_MESSAGE_CUSTOM_TYPE, renderer);
		(pi as any).registerMessageRenderer(LEGACY_REMINDER_MESSAGE_CUSTOM_TYPE, renderer);
	}

	pi.on("session_start", (_event, ctx: ExtensionLikeContext) => {
		manager.clearSession();
		refreshConfig();
		writeReminderDiagnostic({
			event: "reminder_session_start",
			sessionId: getSessionId(ctx),
			cwd: getCwd(ctx),
			providerApi: getProviderApi(ctx),
		});
	});

	pi.on("session_shutdown", () => {
		manager.clearSession();
	});

	pi.on("turn_start", () => {
		manager.advanceTurn();
	});

	pi.on("before_agent_start", (_event, ctx) => {
		const announcement = manager.collectDueAnnouncement({ showHiddenInDisplay: debugShowAllInTui() });
		if (!announcement) return;

		const message = buildReminderMessage(announcement, getContextUsage(ctx));
		writeAnnouncementDiagnostic("reminder_history_message", message);

		return { message };
	});

	(pi as any).on("context", (_event: any, ctx: any) => {
		const announcement = manager.collectDueAnnouncement({ showHiddenInDisplay: debugShowAllInTui() });
		if (!announcement) return;

		const message = buildReminderMessage(announcement, getContextUsage(ctx));
		writeAnnouncementDiagnostic("reminder_context_message", message);

		pi.sendMessage(message, { deliverAs: "steer" });
	});

	pi.registerCommand("reminders", {
		description: "Open reminders settings",
		handler: async (_args: string, ctx: any) => {
			refreshConfig();
			const current = debugShowAllInTui() ? "on" : "off";
			const choice = await ctx.ui.select("Reminders debug: show all in TUI", [`${current === "on" ? "[on]" : "on"}`, `${current === "off" ? "[off]" : "off"}`, "← Back"]);
			if (!choice || choice === "← Back") return;

			cfg = utilsConfig.update({ reminders: { ...cfg, debugShowAllInTui: choice.includes("on") } }).reminders;
			ctx.ui.notify(`Reminders debug show-all in TUI ${cfg.debugShowAllInTui ? "enabled" : "disabled"}`, "info");
		},
	});

	pi.registerCommand("remind", {
		description: "Add a debug system reminder",
		handler: async (args: string, ctx: any) => {
			const text = args.trim();
			if (!text) {
				ctx.ui.notify("Usage: /remind <text>", "warning");
				return;
			}

			manager.upsert({
				source: DEBUG_REMINDER_SOURCE,
				id: "debug-command",
				label: "Reminder",
				text,
				priority: 100,
				ttl: "once",
			});
			ctx.ui.notify("Reminder added", "info");
		},
	});

	writeReminderDiagnostic({
		event: "reminder_extension_registered",
		hasEvents: eventBus !== undefined,
		hasRegisterCommand: typeof (pi as any).registerCommand === "function",
		hasRegisterMessageRenderer: typeof (pi as any).registerMessageRenderer === "function",
		hasOn: typeof (pi as any).on === "function",
	});

	return manager;
}

export default function reminderHost(pi: ExtensionAPI): void {
	try {
		registerReminderHost(pi);
	} catch (error) {
		writeReminderDiagnostic({
			event: "reminder_extension_register_error",
			errorName: error instanceof Error ? error.name : undefined,
			errorMessage: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		});
		throw error;
	}
}

function handleListRequest(manager: ReminderManager, request: ReminderListRequest): void {
	try {
		request.resolve(manager.snapshot(request.source));
	} catch (error) {
		request.reject?.(error);
	}
}

function isDebugModeEnabled(config: RemindersConfig): boolean {
	const value = process.env.PI_REMINDERS_DEBUG?.trim().toLowerCase();
	if (value) return value === "1" || value === "true" || value === "yes" || value === "on";
	return config.debugShowAllInTui === true;
}

function buildReminderMessage(announcement: import("./manager.ts").ReminderAnnouncement, usage: ContextUsage | undefined) {
	const sources = [...new Set(announcement.reminders.map((reminder) => reminder.source))].sort();
	const modelBody = includesDcpReminder(announcement.reminders)
		? appendContextUsageLine(stripSystemReminderWrapper(announcement.text), usage)
		: stripSystemReminderWrapper(announcement.text);
	const displayText = announcement.displayText && includesDcpReminder(announcement.displayReminders)
		? appendContextUsageLine(announcement.displayText, usage)
		: announcement.displayText;
	const content = `<system-reminder>\n${modelBody}\n</system-reminder>`;
	return {
		customType: REMINDER_MESSAGE_CUSTOM_TYPE,
		content,
		display: displayText !== null,
		details: {
			reminderCount: announcement.reminders.length,
			sources,
			displayText: displayText ?? undefined,
		},
	};
}

function writeAnnouncementDiagnostic(event: string, message: ReturnType<typeof buildReminderMessage>): void {
	const details = message.details as ReminderMessageDetails | undefined;
	writeReminderDiagnostic({
		event,
		activeReminderCount: details?.reminderCount,
		sources: details?.sources,
		trailerChars: message.content.length,
	});
}

function getContextUsage(ctx: unknown): ContextUsage | undefined {
	if (!isRecord(ctx) || typeof ctx.getContextUsage !== "function") return undefined;
	try {
		const usage = ctx.getContextUsage();
		if (!isRecord(usage) || typeof usage.contextWindow !== "number") return undefined;
		const tokens = typeof usage.tokens === "number" ? usage.tokens : null;
		return { tokens, contextWindow: usage.contextWindow };
	} catch {
		return undefined;
	}
}

function includesDcpReminder(reminders: import("./types.ts").ReminderRecord[]): boolean {
	return reminders.some((reminder) => {
		const source = reminder.source.trim().toLowerCase();
		return source === "dcp" || source === "pi-dynamic-context-pruning";
	});
}

function appendContextUsageLine(displayText: string, usage: ContextUsage | undefined): string {
	if (!usage) return displayText;
	const contextWindow = formatTokenCount(usage.contextWindow);
	if (usage.tokens === null) return `${displayText}\nContext: unknown / ${contextWindow} tokens.`;
	const percent = usage.contextWindow > 0 ? Math.round((usage.tokens / usage.contextWindow) * 100) : 0;
	return `${displayText}\nContext: ${formatTokenCount(usage.tokens)} / ${contextWindow} tokens (${percent}%).`;
}

function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) return `${trimFixed(tokens / 1_000_000)}M`;
	if (tokens >= 1_000) return `${trimFixed(tokens / 1_000)}k`;
	return String(tokens);
}

function trimFixed(value: number): string {
	return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, "");
}

function getProviderApi(ctx: ExtensionLikeContext | undefined): string | undefined {
	return typeof ctx?.model?.api === "string" ? ctx.model.api : undefined;
}

function getSessionId(ctx: ExtensionLikeContext | undefined): string | undefined {
	try {
		return ctx?.sessionManager?.getSessionId?.();
	} catch {
		return undefined;
	}
}

function getCwd(ctx: ExtensionLikeContext | undefined): string | undefined {
	try {
		return ctx?.sessionManager?.getCwd?.();
	} catch {
		return undefined;
	}
}


function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => isRecord(part) && part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function stripSystemReminderWrapper(content: string): string {
	return content
		.replace(/^\s*<system-reminder>\s*/i, "")
		.replace(/\s*<\/system-reminder>\s*$/i, "")
		.trim();
}

function padToWidth(line: string, width: number): string {
	return `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
}

const SYSTEM_REMINDER_MIN_BODY_WIDTH = 76;
const SYSTEM_REMINDER_BODY_WIDTH_RATIO = 0.9;

class SystemReminderComponent implements Component {
	private readonly content: string;
	private readonly details: ReminderMessageDetails | undefined;
	private readonly theme: any;

	constructor(content: string, details: ReminderMessageDetails | undefined, theme: any) {
		this.content = content;
		this.details = details;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (width < 3) return [truncateToWidth("System Reminder", width)];

		const availableBodyWidth = width - 2;
		const preferredBodyWidth = Math.max(
			SYSTEM_REMINDER_MIN_BODY_WIDTH,
			Math.floor(availableBodyWidth * SYSTEM_REMINDER_BODY_WIDTH_RATIO),
		);
		const bodyWidth = Math.max(1, Math.min(availableBodyWidth, preferredBodyWidth));
		const title = " System Reminder ";
		const titleText = truncateToWidth(title, bodyWidth, "");
		const border = (value: string) => this.theme.fg("accent", value);
		const lines = [border(`╭${titleText}${"─".repeat(Math.max(0, bodyWidth - visibleWidth(titleText)))}╮`)];

		const text = new Text(this.content, 0, 0);
		for (const line of text.render(bodyWidth)) {
			const truncated = truncateToWidth(line, bodyWidth, "");
			lines.push(border("│") + padToWidth(truncated, bodyWidth) + border("│"));
		}

		const meta = [
			this.details?.reminderCount !== undefined ? `${this.details.reminderCount} reminder${this.details.reminderCount === 1 ? "" : "s"}` : undefined,
			this.details?.sources?.length ? this.details.sources.join(", ") : undefined,
		].filter(Boolean).join(" · ");
		if (meta) {
			const metaLine = truncateToWidth(this.theme.fg("dim", meta), bodyWidth, "");
			lines.push(border("│") + padToWidth(metaLine, bodyWidth) + border("│"));
		}

		lines.push(border(`╰${"─".repeat(bodyWidth)}╯`));
		return lines;
	}
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}
