import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { expect } from "./reminders-expect.ts";

import { registerReminderHost } from "../src/reminders/index.ts";
import {
	REMINDER_ANNOUNCE_NOW_EVENT,
	REMINDER_CLEAR_SOURCE_EVENT,
	REMINDER_LIST_EVENT,
	REMINDER_REMOVE_EVENT,
	REMINDER_UPSERT_EVENT,
} from "../src/reminders/types.ts";
import type { ReminderSnapshot } from "../src/reminders/types.ts";

class MockEvents {
	private readonly handlers = new Map<string, Array<(payload: unknown) => void>>();

	on(event: string, handler: (payload: unknown) => void): void {
		const handlers = this.handlers.get(event) ?? [];
		handlers.push(handler);
		this.handlers.set(event, handlers);
	}

	emit(event: string, payload?: unknown): void {
		for (const handler of this.handlers.get(event) ?? []) {
			handler(payload);
		}
	}
}

class MockPi {
	readonly events = new MockEvents();
	readonly commands = new Map<string, { description?: string; handler: (args: string, ctx: any) => unknown }>();
	readonly renderers = new Map<string, (message: any, options: unknown, theme: any) => { render: (width: number) => string[] }>();
	readonly sentMessages: Array<{ message: any; options?: any }> = [];
	private readonly hooks = new Map<string, Array<(event?: any, ctx?: any) => unknown>>();

	on(event: string, handler: (event?: any, ctx?: any) => unknown): void {
		const handlers = this.hooks.get(event) ?? [];
		handlers.push(handler);
		this.hooks.set(event, handlers);
	}

	registerCommand(name: string, command: { description?: string; handler: (args: string, ctx: any) => unknown }): void {
		this.commands.set(name, command);
	}

	registerMessageRenderer(type: string, renderer: (message: any, options: unknown, theme: any) => { render: (width: number) => string[] }): void {
		this.renderers.set(type, renderer);
	}

	sendMessage(message: any, options?: any): void {
		this.sentMessages.push({ message, options });
	}

	async trigger(event: string, payload?: any, ctx?: any): Promise<unknown[]> {
		const results: unknown[] = [];
		for (const handler of this.hooks.get(event) ?? []) {
			results.push(await handler(payload, ctx));
		}
		return results;
	}
}

const anthropicCtx = { model: { api: "anthropic-messages" } };
const openAiCtx = { model: { api: "openai-responses" } };
const usageCtx = {
	model: { api: "openai-responses" },
	getContextUsage: () => ({ tokens: 68_000, contextWindow: 200_000 }),
};
const mockTheme = {
	fg: (_color: string, value: string) => value,
};

describe("pi-reminders extension integration", () => {
	test("wires reminder events to the manager", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "dcp",
			id: "nudge",
			text: "compress older closed ranges",
			ttl: "persistent",
		});

		let snapshot: ReminderSnapshot | undefined;
		pi.events.emit(REMINDER_LIST_EVENT, {
			resolve: (value: ReminderSnapshot) => {
				snapshot = value;
			},
		});

		expect(snapshot?.count).toBe(1);
		expect(snapshot?.reminders[0]).toMatchObject({ source: "dcp", id: "nudge", ttl: "persistent" });

		pi.events.emit(REMINDER_REMOVE_EVENT, { source: "dcp", id: "nudge" });
		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "pi-dag-tasks",
			id: "state",
			text: "1 active task",
			ttl: "persistent",
		});
		pi.events.emit(REMINDER_CLEAR_SOURCE_EVENT, { source: "pi-dag-tasks" });

		pi.events.emit(REMINDER_LIST_EVENT, {
			resolve: (value: ReminderSnapshot) => {
				snapshot = value;
			},
		});

		expect(snapshot?.count).toBe(0);
	});

	test("before_agent_start writes due reminders as one durable custom message", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "pi-dag-tasks",
			id: "state",
			text: "2 ready tasks",
			ttl: "persistent",
		});
		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "dcp",
			id: "nudge",
			text: "compress now",
		});

		const [result] = await pi.trigger("before_agent_start", {}, anthropicCtx);

		expect(result).toEqual({
			message: {
				customType: "pi-reminders",
				content: "<system-reminder>\nDCP: compress now\nTasks: 2 ready tasks\n</system-reminder>",
				display: true,
				details: {
					reminderCount: 2,
					sources: ["dcp", "pi-dag-tasks"],
					displayText: "DCP: compress now\nTasks: 2 ready tasks",
				},
			},
		});

		const renderer = pi.renderers.get("pi-reminders");
		expect(renderer).toBeDefined();
		const lines = renderer!((result as any).message, {}, mockTheme).render(80).join("\n");
		expect(lines).toContain("DCP: compress now");
		expect(lines).toContain("Tasks: 2 ready tasks");
		expect(lines).not.toContain("<system-reminder>");
		expect(lines).not.toContain("</system-reminder>");

		let snapshot: ReminderSnapshot | undefined;
		pi.events.emit(REMINDER_LIST_EVENT, { resolve: (value: ReminderSnapshot) => { snapshot = value; } });
		expect(snapshot?.reminders.map((reminder) => reminder.id)).toEqual(["state"]);
	});

	test("custom message renderer strips wrapper tags without details fallback", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		const renderer = pi.renderers.get("pi-reminders");
		expect(renderer).toBeDefined();
		const lines = renderer!({
			content: "<system-reminder>\nReminder: inspect injected reminder\n</system-reminder>",
		}, {}, mockTheme).render(80).join("\n");

		expect(lines).toContain("Reminder: inspect injected reminder");
		expect(lines).not.toContain("<system-reminder>");
		expect(lines).not.toContain("</system-reminder>");
	});

	test("persistent reminders do not repeat every request without change or interval", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "pi-dag-tasks",
			id: "state",
			text: "2 ready tasks",
			ttl: "persistent",
		});

		const [firstResult] = await pi.trigger("before_agent_start", {}, usageCtx);
		expect(firstResult).toMatchObject({
			message: {
				content: "<system-reminder>\nTasks: 2 ready tasks\n</system-reminder>",
				details: { displayText: "Tasks: 2 ready tasks" },
			},
		});
		expect(JSON.stringify(firstResult)).not.toContain("Context:");
		expect(await pi.trigger("before_agent_start", {}, openAiCtx)).toEqual([undefined]);
		expect(await pi.trigger("before_provider_request", { payload: { input: [] } }, openAiCtx)).toEqual([]);
		expect(await pi.trigger("context", { messages: [] }, openAiCtx)).toEqual([undefined]);
	});

	test("context hook persists due reminders during agent turns with token usage", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "dcp",
			id: "nudge",
			text: "compress now",
		});

		const messages = [{ role: "user", content: "hi" }];
		const [result] = await pi.trigger("context", { messages }, usageCtx);

		expect(result).toBeUndefined();
		expect(messages).toEqual([{ role: "user", content: "hi" }]);
		expect(pi.sentMessages).toEqual([
			{
				message: {
					customType: "pi-reminders",
					content: "<system-reminder>\nDCP: compress now\nContext: 68k / 200k tokens (34%).\n</system-reminder>",
					display: true,
					details: {
						reminderCount: 1,
						sources: ["dcp"],
						displayText: "DCP: compress now\nContext: 68k / 200k tokens (34%).",
					},
				},
				options: { deliverAs: "steer" },
			},
		]);
		expect(await pi.trigger("context", { messages: [] }, usageCtx)).toEqual([undefined]);
		expect(pi.sentMessages).toHaveLength(1);
	});

	test("hidden reminders are sent to the model but omitted from chat display", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "dcp",
			id: "hidden",
			text: "compress silently",
			display: false,
		});
		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "pi-dag-tasks",
			id: "state",
			text: "2 ready tasks",
			ttl: "persistent",
			display: true,
		});

		const [result] = await pi.trigger("before_agent_start", {}, usageCtx);

		expect(result).toMatchObject({
			message: {
				content: "<system-reminder>\nDCP: compress silently\nTasks: 2 ready tasks\nContext: 68k / 200k tokens (34%).\n</system-reminder>",
				display: true,
				details: {
					displayText: "Tasks: 2 ready tasks",
				},
			},
		});
	});

	test("debug mode shows hidden reminders in chat display", async () => {
		const previous = process.env.PI_REMINDERS_DEBUG;
		process.env.PI_REMINDERS_DEBUG = "true";
		try {
			const pi = new MockPi();
			registerReminderHost(pi as any);

			pi.events.emit(REMINDER_UPSERT_EVENT, {
				source: "dcp",
				id: "hidden",
				text: "compress silently",
				display: false,
			});
			pi.events.emit(REMINDER_UPSERT_EVENT, {
				source: "pi-dag-tasks",
				id: "state",
				text: "2 ready tasks",
				ttl: "persistent",
				display: true,
			});

			const [result] = await pi.trigger("before_agent_start", {}, usageCtx);

			expect(result).toMatchObject({
				message: {
					content: "<system-reminder>\nDCP: compress silently\nTasks: 2 ready tasks\nContext: 68k / 200k tokens (34%).\n</system-reminder>",
					display: true,
					details: {
						displayText: "DCP: compress silently\nTasks: 2 ready tasks\nContext: 68k / 200k tokens (34%).",
					},
				},
			});
		} finally {
			if (previous === undefined) {
				delete process.env.PI_REMINDERS_DEBUG;
			} else {
				process.env.PI_REMINDERS_DEBUG = previous;
			}
		}
	});

	test("/reminders command saves debug show-all setting", async () => {
		const previous = process.env.PI_REMINDERS_DEBUG;
		delete process.env.PI_REMINDERS_DEBUG;
		const cwd = mkdtempSync(join(tmpdir(), "pi-reminders-test-"));
		try {
			const pi = new MockPi();
			registerReminderHost(pi as any);
			const command = pi.commands.get("reminders");
			expect(command).toBeDefined();

			await command!.handler("", {
				cwd,
				ui: {
					select: async () => "on",
					notify: () => {},
				},
			});

			pi.events.emit(REMINDER_UPSERT_EVENT, {
				source: "dcp",
				id: "hidden",
				text: "compress silently",
				display: false,
			});

			const [result] = await pi.trigger("before_agent_start", {}, { ...usageCtx, cwd });
			expect(result).toMatchObject({
				message: {
					details: {
						displayText: "DCP: compress silently\nContext: 68k / 200k tokens (34%).",
					},
				},
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			if (previous === undefined) {
				delete process.env.PI_REMINDERS_DEBUG;
			} else {
				process.env.PI_REMINDERS_DEBUG = previous;
			}
		}
	});

	test("all-hidden reminders are model-visible but not displayed in chat", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "dcp",
			id: "hidden",
			text: "compress silently",
			display: false,
		});

		const [result] = await pi.trigger("before_agent_start", {}, usageCtx);

		expect(result).toMatchObject({
			message: {
				content: "<system-reminder>\nDCP: compress silently\nContext: 68k / 200k tokens (34%).\n</system-reminder>",
				display: false,
				details: {
					displayText: undefined,
				},
			},
		});
	});

	test("persistent reminders repeat after repeatEveryTurns", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		pi.events.emit(REMINDER_UPSERT_EVENT, {
			source: "pi-dag-tasks",
			id: "state",
			text: "2 ready tasks",
			ttl: "persistent",
			repeatEveryTurns: 2,
		});

		expect((await pi.trigger("before_agent_start", {}, openAiCtx))[0]).toMatchObject({ message: { customType: "pi-reminders" } });
		await pi.trigger("turn_start");
		expect(await pi.trigger("context", { messages: [] }, openAiCtx)).toEqual([undefined]);
		expect(pi.sentMessages).toHaveLength(0);
		await pi.trigger("turn_start");
		expect(await pi.trigger("context", { messages: [] }, openAiCtx)).toEqual([undefined]);
		expect(pi.sentMessages).toEqual([
			{
				message: {
					customType: "pi-reminders",
					content: "<system-reminder>\nTasks: 2 ready tasks\n</system-reminder>",
					display: true,
					details: { reminderCount: 1, sources: ["pi-dag-tasks"], displayText: "Tasks: 2 ready tasks" },
				},
				options: { deliverAs: "steer" },
			},
		]);
	});

	test("announce-now forces one or all active reminders", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		pi.events.emit(REMINDER_UPSERT_EVENT, { source: "dcp", id: "a", text: "A", ttl: "persistent" });
		pi.events.emit(REMINDER_UPSERT_EVENT, { source: "tasks", id: "b", text: "B", ttl: "persistent" });
		await pi.trigger("before_agent_start", {}, openAiCtx);
		expect(await pi.trigger("before_agent_start", {}, openAiCtx)).toEqual([undefined]);

		pi.events.emit(REMINDER_ANNOUNCE_NOW_EVENT, { source: "tasks", id: "b" });
		expect((await pi.trigger("before_agent_start", {}, openAiCtx))[0]).toMatchObject({
			message: { content: "<system-reminder>\nTasks: B\n</system-reminder>" },
		});

		pi.events.emit(REMINDER_ANNOUNCE_NOW_EVENT);
		expect((await pi.trigger("before_agent_start", {}, openAiCtx))[0]).toMatchObject({
			message: { content: "<system-reminder>\nDCP: A\nTasks: B\n</system-reminder>" },
		});
	});

	test("/remind command adds a once debug reminder", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		const notifications: Array<{ message: string; level: string }> = [];
		await pi.commands.get("remind")?.handler("inspect injected reminder", {
			ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
		});

		const [result] = await pi.trigger("before_agent_start", {}, usageCtx);

		expect(notifications).toEqual([{ message: "Reminder added", level: "info" }]);
		expect(result).toMatchObject({
			message: {
				customType: "pi-reminders",
				content: "<system-reminder>\nReminder: inspect injected reminder\n</system-reminder>",
				details: { displayText: "Reminder: inspect injected reminder" },
			},
		});
		expect(JSON.stringify(result)).not.toContain("Context:");
		expect(await pi.trigger("before_agent_start", {}, openAiCtx)).toEqual([undefined]);
	});

	test("/remind command rejects empty text", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		const notifications: Array<{ message: string; level: string }> = [];
		await pi.commands.get("remind")?.handler("   ", {
			ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
		});

		let snapshot: ReminderSnapshot | undefined;
		pi.events.emit(REMINDER_LIST_EVENT, { resolve: (value: ReminderSnapshot) => { snapshot = value; } });

		expect(notifications).toEqual([{ message: "Usage: /remind <text>", level: "warning" }]);
		expect(snapshot?.count).toBe(0);
	});

	test("session hooks clear session and persistent reminders", async () => {
		const pi = new MockPi();
		registerReminderHost(pi as any);

		pi.events.emit(REMINDER_UPSERT_EVENT, { source: "dcp", id: "session", text: "session", ttl: "session" });
		pi.events.emit(REMINDER_UPSERT_EVENT, { source: "tasks", id: "persistent", text: "persistent", ttl: "persistent" });

		await pi.trigger("session_shutdown");

		let snapshot: ReminderSnapshot | undefined;
		pi.events.emit(REMINDER_LIST_EVENT, {
			resolve: (value: ReminderSnapshot) => {
				snapshot = value;
			},
		});
		expect(snapshot?.count).toBe(0);
	});
});
