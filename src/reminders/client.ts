import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	REMINDER_ANNOUNCE_NOW_EVENT,
	REMINDER_CLEAR_SOURCE_EVENT,
	REMINDER_LIST_EVENT,
	REMINDER_REMOVE_EVENT,
	REMINDER_UPSERT_EVENT,
	type ReminderAnnounceNowRequest,
	type ReminderIntent,
	type ReminderSnapshot,
} from "./types.ts";

export interface RemindersClient {
	upsert(intent: ReminderIntent): void;
	remove(source: string, key: string): void;
	clearSource(source: string): void;
	announceNow(payload?: ReminderAnnounceNowRequest): void;
	list(source?: string): Promise<ReminderSnapshot>;
}

export function createRemindersClient(pi: ExtensionAPI, isDisposed: () => boolean): RemindersClient {
	return {
		upsert(intent) {
			if (isDisposed()) return;
			pi.events.emit(REMINDER_UPSERT_EVENT, intent);
		},
		remove(source, key) {
			if (isDisposed()) return;
			pi.events.emit(REMINDER_REMOVE_EVENT, { source, id: key });
		},
		clearSource(source) {
			if (isDisposed()) return;
			pi.events.emit(REMINDER_CLEAR_SOURCE_EVENT, { source });
		},
		announceNow(payload = {}) {
			if (isDisposed()) return;
			pi.events.emit(REMINDER_ANNOUNCE_NOW_EVENT, payload);
		},
		list(source) {
			if (isDisposed()) return Promise.resolve(emptyReminderSnapshot());
			let settled = false;
			let resolveSnapshot!: (snapshot: ReminderSnapshot) => void;
			let rejectSnapshot!: (error: unknown) => void;
			const promise = new Promise<ReminderSnapshot>((resolve, reject) => {
				resolveSnapshot = (snapshot) => {
					settled = true;
					resolve(snapshot);
				};
				rejectSnapshot = (error) => {
					settled = true;
					reject(error);
				};
			});
			pi.events.emit(REMINDER_LIST_EVENT, { source, resolve: resolveSnapshot, reject: rejectSnapshot });
			if (!settled) resolveSnapshot(emptyReminderSnapshot());
			return promise;
		},
	};
}

function emptyReminderSnapshot(): ReminderSnapshot {
	return { reminders: [], count: 0 };
}
