import { describe, test } from "node:test";
import { expect } from "./reminders-expect.ts";

import { ReminderManager } from "../src/reminders/manager.ts";

describe("ReminderManager", () => {
	test("upsert replaces reminders by source and id", () => {
		let now = 100;
		const manager = new ReminderManager({ clock: () => now++ });

		expect(manager.upsert({ source: "dcp", id: "nudge", text: "first", priority: 1 })).toBe(true);
		expect(manager.upsert({ source: "dcp", id: "nudge", text: "second", priority: 2 })).toBe(true);

		const snapshot = manager.snapshot();
		expect(snapshot.count).toBe(1);
		expect(snapshot.reminders[0]).toMatchObject({
			source: "dcp",
			id: "nudge",
			text: "second",
			priority: 2,
			ttl: "once",
		});
		expect(snapshot.reminders[0].createdAt).toBe(100);
		expect(snapshot.reminders[0].updatedAt).toBe(101);
	});

	test("empty text removes an existing reminder", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "dcp", id: "nudge", text: "compress", ttl: "persistent" });

		expect(manager.upsert({ source: "dcp", id: "nudge", text: "   " })).toBe(true);
		expect(manager.size).toBe(0);
	});

	test("remove and clearSource delete matching reminders only", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "dcp", id: "a", text: "A", ttl: "persistent" });
		manager.upsert({ source: "dcp", id: "b", text: "B", ttl: "persistent" });
		manager.upsert({ source: "pi-dag-tasks", id: "a", text: "Tasks", ttl: "persistent" });

		expect(manager.remove({ source: "dcp", id: "a" })).toBe(true);
		expect(manager.snapshot().reminders.map((r) => `${r.source}:${r.id}`)).toEqual([
			"dcp:b",
			"pi-dag-tasks:a",
		]);

		expect(manager.clearSource({ source: "dcp" })).toBe(1);
		expect(manager.snapshot().reminders.map((r) => `${r.source}:${r.id}`)).toEqual(["pi-dag-tasks:a"]);
	});

	test("once reminders announce once then delete", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "dcp", id: "one-shot", text: "compress now" });
		manager.upsert({ source: "pi-dag-tasks", id: "state", text: "tasks", ttl: "persistent" });

		expect(manager.collectDueAnnouncement()?.text).toBe(
			"<system-reminder>\nDCP: compress now\nTasks: tasks\n</system-reminder>"
		);
		expect(manager.snapshot().reminders.map((r) => r.id)).toEqual(["state"]);
		expect(manager.collectDueAnnouncement()).toBeNull();
	});

	test("session and persistent reminders announce on create and change only", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "dcp", id: "session", text: "first", ttl: "session" });
		manager.upsert({ source: "tasks", id: "state", text: "ready", ttl: "persistent" });

		expect(manager.collectDueAnnouncement()?.text).toBe(
			"<system-reminder>\nDCP: first\nTasks: ready\n</system-reminder>"
		);
		expect(manager.collectDueAnnouncement()).toBeNull();

		manager.upsert({ source: "dcp", id: "session", text: "second", ttl: "session" });
		expect(manager.collectDueAnnouncement()?.text).toBe(
			"<system-reminder>\nDCP: second\n</system-reminder>"
		);
		expect(manager.collectDueAnnouncement()).toBeNull();
	});

	test("persistent reminders can repeat after turn interval", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "tasks", id: "state", text: "ready", ttl: "persistent", repeatEveryTurns: 2 });

		expect(manager.collectDueAnnouncement()?.text).toBe("<system-reminder>\nTasks: ready\n</system-reminder>");
		manager.advanceTurn();
		expect(manager.collectDueAnnouncement()).toBeNull();
		manager.advanceTurn();
		expect(manager.collectDueAnnouncement()?.text).toBe("<system-reminder>\nTasks: ready\n</system-reminder>");
	});

	test("announce-now forces one or all active reminders", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "dcp", id: "a", text: "A", ttl: "persistent" });
		manager.upsert({ source: "tasks", id: "b", text: "B", ttl: "persistent" });
		expect(manager.collectDueAnnouncement()).not.toBeNull();
		expect(manager.collectDueAnnouncement()).toBeNull();

		expect(manager.forceAnnounce({ source: "tasks", id: "b" })).toBe(1);
		expect(manager.collectDueAnnouncement()?.text).toBe("<system-reminder>\nTasks: B\n</system-reminder>");

		expect(manager.forceAnnounce()).toBe(2);
		expect(manager.collectDueAnnouncement()?.text).toBe(
			"<system-reminder>\nDCP: A\nTasks: B\n</system-reminder>"
		);
	});

	test("session shutdown clears session and persistent reminders", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "dcp", id: "persistent", text: "keep", ttl: "persistent" });
		manager.upsert({ source: "tasks", id: "session", text: "session", ttl: "session" });

		manager.clearSession();
		expect(manager.size).toBe(0);
	});

	test("render order is deterministic by group priority, label, and reminder id", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "pi-dag-tasks", id: "state", text: "tasks", priority: 5, ttl: "persistent" });
		manager.upsert({ source: "dcp", id: "b", text: "second", priority: 10, ttl: "persistent" });
		manager.upsert({ source: "dcp", id: "a", text: "first", priority: 10, ttl: "persistent" });
		manager.upsert({ source: "pi-subagents", id: "status", text: "subagent", priority: 5, ttl: "persistent" });

		expect(manager.render()).toBe(
			[
				"<system-reminder>",
				"DCP: first; second",
				"Subagents: subagent",
				"Tasks: tasks",
				"</system-reminder>",
			].join("\n")
		);
	});

	test("hidden reminders stay model-visible but are omitted from display text", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "dcp", id: "hidden", text: "compress", display: false });
		manager.upsert({ source: "tasks", id: "visible", text: "tasks", ttl: "persistent" });

		expect(manager.collectDueAnnouncement()).toMatchObject({
			text: "<system-reminder>\nDCP: compress\nTasks: tasks\n</system-reminder>",
			displayText: "Tasks: tasks",
		});
	});

	test("debug display mode includes hidden reminders in display text", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "dcp", id: "hidden", text: "compress", display: false });
		manager.upsert({ source: "tasks", id: "visible", text: "tasks", ttl: "persistent" });

		expect(manager.collectDueAnnouncement({ showHiddenInDisplay: true })).toMatchObject({
			text: "<system-reminder>\nDCP: compress\nTasks: tasks\n</system-reminder>",
			displayText: "DCP: compress\nTasks: tasks",
		});
	});

	test("snapshot clones records and filters by source", () => {
		const manager = new ReminderManager();
		manager.upsert({ source: "dcp", id: "a", text: "A", ttl: "persistent", display: false, metadata: { nested: true } });
		manager.upsert({ source: "tasks", id: "b", text: "B", ttl: "persistent" });

		const snapshot = manager.snapshot("dcp");
		expect(snapshot.count).toBe(1);
		snapshot.reminders[0].text = "mutated";
		snapshot.reminders[0].metadata = { changed: true };

		expect(manager.snapshot("dcp").reminders[0]).toMatchObject({ text: "A", display: false, metadata: { nested: true } });
	});

	test("invalid source or id is rejected without changing state", () => {
		const manager = new ReminderManager();
		expect(manager.upsert({ source: "", id: "x", text: "bad" })).toBe(false);
		expect(manager.upsert({ source: "dcp", id: " ", text: "bad" })).toBe(false);
		expect(manager.size).toBe(0);
	});
});
