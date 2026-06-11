import { describe, test } from "node:test";
import { expect } from "./reminders-expect.ts";

import { buildReminderCacheDiagnostics } from "../src/reminders/debug.ts";
import type { ReminderSnapshot } from "../src/reminders/types.ts";

const snapshot: ReminderSnapshot = {
	count: 2,
	reminders: [
		{
			source: "pi-dag-tasks",
			id: "state",
			label: "Tasks",
			text: "2 ready tasks",
			priority: 20,
			display: true,
			ttl: "persistent",
			createdAt: 1,
			updatedAt: 1,
		},
		{
			source: "dcp",
			id: "nudge",
			label: "DCP",
			text: "compress older ranges",
			priority: 10,
			display: true,
			ttl: "once",
			createdAt: 2,
			updatedAt: 2,
		},
	],
};

describe("reminder cache diagnostics", () => {
	test("records cache markers and hashes without full trailer text", () => {
		const payload = {
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "stable", cache_control: { type: "ephemeral" } }],
				},
			],
		};
		const trailer = "<system-reminder>\nTasks: 2 ready tasks\nDCP: compress older ranges\n</system-reminder>";
		const resultPayload = {
			...payload,
			messages: [
				...payload.messages,
				{ role: "user", content: [{ type: "text", text: trailer }] },
			],
		};

		const diagnostics = buildReminderCacheDiagnostics({
			payload,
			resultPayload,
			snapshot,
			trailer,
			inserted: true,
		});

		expect(diagnostics.inserted).toBe(true);
		expect(diagnostics.payloadShape).toBe("messages");
		expect(diagnostics.messagesBefore).toBe(1);
		expect(diagnostics.messagesAfter).toBe(2);
		expect(diagnostics.activeReminderCount).toBe(2);
		expect(diagnostics.activeReminderSources).toEqual(["dcp", "pi-dag-tasks"]);
		expect(diagnostics.activeReminderLabels).toEqual(["DCP", "Tasks"]);
		expect(diagnostics.trailerChars).toBe(trailer.length);
		expect(diagnostics.trailerHash).toMatch(/^[0-9a-f]{16}$/);
		expect(diagnostics.stablePrefixHash).toMatch(/^[0-9a-f]{16}$/);
		expect(diagnostics.cacheControlBeforeCount).toBe(1);
		expect(diagnostics.cacheControlBeforePaths).toEqual(["messages[0].content[0].cache_control"]);
		expect(diagnostics.cacheControlInOrAfterTrailerCount).toBe(0);
		expect(JSON.stringify(diagnostics)).not.toContain("2 ready tasks");
		expect(JSON.stringify(diagnostics)).not.toContain("compress older ranges");
	});

	test("records live Pi input-array payload shape", () => {
		const payload = {
			input: [
				{
					role: "user",
					content: [{ type: "text", text: "stable", cache_control: { type: "ephemeral" } }],
				},
			],
		};
		const trailer = "<system-reminder>\nTasks: 2 ready tasks\n</system-reminder>";
		const resultPayload = {
			...payload,
			input: [
				...payload.input,
				{ role: "user", content: [{ type: "text", text: trailer }] },
			],
		};

		const diagnostics = buildReminderCacheDiagnostics({
			payload,
			resultPayload,
			snapshot,
			trailer,
			inserted: true,
		});

		expect(diagnostics.payloadShape).toBe("input");
		expect(diagnostics.messagesBefore).toBe(1);
		expect(diagnostics.messagesAfter).toBe(2);
		expect(diagnostics.cacheControlBeforePaths).toEqual(["input[0].content[0].cache_control"]);
		expect(diagnostics.cacheControlInOrAfterTrailerPaths).toEqual([]);
	});

	test("records unsupported payload skip reason without message counts", () => {
		const diagnostics = buildReminderCacheDiagnostics({
			payload: { body: [] },
			snapshot,
			trailer: null,
			inserted: false,
			skippedReason: "unsupported_payload_shape",
		});

		expect(diagnostics.inserted).toBe(false);
		expect(diagnostics.skippedReason).toBe("unsupported_payload_shape");
		expect(diagnostics.payloadShape).toBe("unsupported");
		expect(diagnostics.messagesBefore).toBeNull();
		expect(diagnostics.messagesAfter).toBeNull();
		expect(diagnostics.trailerHash).toBeNull();
		expect(diagnostics.stablePrefixHash).toBeNull();
	});
});
