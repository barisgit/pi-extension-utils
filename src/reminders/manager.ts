import { createHash } from "node:crypto";
import { renderReminderBody, renderReminderTrailer } from "./renderer.ts";
import type {
	ReminderAnnounceNowRequest,
	ReminderClearSourceRequest,
	ReminderIntent,
	ReminderRecord,
	ReminderRemoveRequest,
	ReminderSnapshot,
	ReminderTtl,
} from "./types.ts";

const DEFAULT_TTL: ReminderTtl = "once";

interface StoredReminder extends ReminderRecord {
	lastAnnouncedTextHash?: string;
	lastAnnouncedTurn?: number;
	forceAnnounce?: boolean;
}

export interface ReminderAnnouncement {
	text: string;
	displayText: string | null;
	reminders: ReminderRecord[];
	displayReminders: ReminderRecord[];
}

/** In-memory store for system reminder intents and announcement state. */
export class ReminderManager {
	private readonly reminders = new Map<string, StoredReminder>();
	private clock: () => number;
	private turnIndex = 0;

	constructor(options: { clock?: () => number } = {}) {
		this.clock = options.clock ?? Date.now;
	}

	upsert(intent: ReminderIntent): boolean {
		const normalized = normalizeIntent(intent);
		if (!normalized) return false;

		if (normalized.text.trim().length === 0) {
			return this.remove({ source: normalized.source, id: normalized.id });
		}

		const now = this.clock();
		const key = reminderKey(normalized.source, normalized.id);
		const existing = this.reminders.get(key);
		const textHash = hashReminderText(normalized);

		this.reminders.set(key, {
			...normalized,
			priority: normalized.priority ?? 0,
			display: normalized.display ?? true,
			ttl: normalized.ttl ?? DEFAULT_TTL,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			lastAnnouncedTextHash: existing?.lastAnnouncedTextHash,
			lastAnnouncedTurn: existing?.lastAnnouncedTurn,
			forceAnnounce: existing?.forceAnnounce || existing?.lastAnnouncedTextHash !== textHash,
		});
		return true;
	}

	remove(request: ReminderRemoveRequest): boolean {
		const source = request.source.trim();
		const id = request.id.trim();
		if (!source || !id) return false;
		return this.reminders.delete(reminderKey(source, id));
	}

	clearSource(request: ReminderClearSourceRequest): number {
		const source = request.source.trim();
		if (!source) return 0;

		let removed = 0;
		for (const [key, reminder] of this.reminders) {
			if (reminder.source === source) {
				this.reminders.delete(key);
				removed++;
			}
		}
		return removed;
	}

	clearSession(): void {
		this.reminders.clear();
		this.turnIndex = 0;
	}

	advanceTurn(): void {
		this.turnIndex++;
	}

	forceAnnounce(request: ReminderAnnounceNowRequest = {}): number {
		const source = request.source?.trim();
		const id = request.id?.trim();
		let count = 0;

		for (const reminder of this.reminders.values()) {
			if (source && reminder.source !== source) continue;
			if (id && reminder.id !== id) continue;
			reminder.forceAnnounce = true;
			count++;
		}
		return count;
	}

	snapshot(source?: string): ReminderSnapshot {
		const filtered = this.sortedRecords().filter((reminder) => source === undefined || reminder.source === source);
		return {
			reminders: filtered.map(cloneRecord),
			count: filtered.length,
		};
	}

	render(): string | null {
		return renderReminderTrailer(this.sortedRecords());
	}

	collectDueAnnouncement(options: { showHiddenInDisplay?: boolean } = {}): ReminderAnnouncement | null {
		const due = this.sortedStoredRecords().filter((reminder) => this.isDue(reminder));
		const text = renderReminderTrailer(due);
		if (!text) return null;

		const displayReminders = options.showHiddenInDisplay ? due : due.filter((reminder) => reminder.display);
		const displayText = renderReminderBody(displayReminders);
		const announced = due.map(cloneRecord);
		const displayed = displayReminders.map(cloneRecord);
		this.markAnnounced(due);
		return { text, displayText, reminders: announced, displayReminders: displayed };
	}

	get size(): number {
		return this.reminders.size;
	}

	private isDue(reminder: StoredReminder): boolean {
		if (reminder.forceAnnounce) return true;

		const textHash = hashReminderText(reminder);
		if (reminder.lastAnnouncedTextHash !== textHash) return true;

		if (reminder.ttl !== "persistent") return false;
		if (!reminder.repeatEveryTurns || reminder.repeatEveryTurns <= 0) return false;
		if (reminder.lastAnnouncedTurn === undefined) return true;
		return this.turnIndex - reminder.lastAnnouncedTurn >= reminder.repeatEveryTurns;
	}

	private markAnnounced(reminders: readonly StoredReminder[]): void {
		for (const reminder of reminders) {
			const key = reminderKey(reminder.source, reminder.id);
			const stored = this.reminders.get(key);
			if (!stored) continue;

			if (stored.ttl === "once") {
				this.reminders.delete(key);
				continue;
			}

			stored.lastAnnouncedTextHash = hashReminderText(stored);
			stored.lastAnnouncedTurn = this.turnIndex;
			stored.forceAnnounce = false;
		}
	}

	private sortedRecords(): ReminderRecord[] {
		return this.sortedStoredRecords().map(cloneRecord);
	}

	private sortedStoredRecords(): StoredReminder[] {
		return [...this.reminders.values()].sort(compareRecords);
	}
}

function normalizeIntent(intent: ReminderIntent): ReminderIntent | null {
	const source = intent.source?.trim();
	const id = intent.id?.trim();
	if (!source || !id) return null;

	const priority = intent.priority;
	const repeatEveryTurns = intent.repeatEveryTurns;
	return {
		...intent,
		source,
		id,
		text: String(intent.text ?? ""),
		label: intent.label?.trim(),
		priority: Number.isFinite(priority) ? Math.trunc(priority as number) : undefined,
		display: intent.display !== false,
		ttl: normalizeTtl(intent.ttl),
		repeatEveryTurns: Number.isFinite(repeatEveryTurns) && repeatEveryTurns! > 0
			? Math.trunc(repeatEveryTurns as number)
			: undefined,
		metadata: cloneMetadata(intent.metadata),
	};
}

function normalizeTtl(ttl: ReminderTtl | undefined): ReminderTtl | undefined {
	if (ttl === undefined) return undefined;
	return ttl === "once" || ttl === "persistent" || ttl === "session" ? ttl : undefined;
}

function reminderKey(source: string, id: string): string {
	return `${source}\u0000${id}`;
}

function compareRecords(a: ReminderRecord, b: ReminderRecord): number {
	return b.priority - a.priority || a.source.localeCompare(b.source) || a.id.localeCompare(b.id);
}

function cloneRecord(record: ReminderRecord): ReminderRecord {
	return {
		id: record.id,
		source: record.source,
		text: record.text,
		label: record.label,
		priority: record.priority,
		display: record.display,
		ttl: record.ttl,
		repeatEveryTurns: record.repeatEveryTurns,
		metadata: cloneMetadata(record.metadata),
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function cloneMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	return metadata === undefined ? undefined : { ...metadata };
}

function hashReminderText(reminder: Pick<ReminderIntent, "source" | "id" | "text" | "label" | "priority" | "display">): string {
	return createHash("sha256")
		.update(JSON.stringify({
			id: reminder.id,
			label: reminder.label,
			priority: reminder.priority,
			display: reminder.display,
			source: reminder.source,
			text: reminder.text,
		}))
		.digest("hex");
}
