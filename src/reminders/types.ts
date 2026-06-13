export const REMINDER_MESSAGE_CUSTOM_TYPE = "pi-extension-utils:reminders";
export const LEGACY_REMINDER_MESSAGE_CUSTOM_TYPE = "pi-reminders";
export const DEBUG_REMINDER_SOURCE = "pi-extension-utils";

export const REMINDER_UPSERT_EVENT = "reminder:upsert";
export const REMINDER_REMOVE_EVENT = "reminder:remove";
export const REMINDER_CLEAR_SOURCE_EVENT = "reminder:clear-source";
export const REMINDER_LIST_EVENT = "reminder:list";
export const REMINDER_ANNOUNCE_NOW_EVENT = "reminder:announce-now";

export type ReminderTtl = "once" | "session" | "persistent";

export interface ReminderIntent {
	/** Stable unique ID within the producer source. */
	id: string;
	/** Producer namespace, e.g. "pi-dag-tasks", "dcp", "pi-subagents". */
	source: string;
	/** Compact model-facing reminder text. Source/id are not rendered by default. */
	text: string;
	/** Optional compact display label, e.g. "Tasks", "DCP", "Subagents". */
	label?: string;
	/** Higher values render earlier. Default: 0. */
	priority?: number;
	/** Whether this reminder should be shown in chat. Default: true. */
	display?: boolean;
	/** Lifecycle policy. Default: "once". */
	ttl?: ReminderTtl;
	/** Optional turn interval for repeating persistent reminders. */
	repeatEveryTurns?: number;
	/** Optional structured metadata for debugging; never rendered in the normal reminder. */
	metadata?: Record<string, unknown>;
}

export interface ReminderRemoveRequest {
	source: string;
	id: string;
}

export interface ReminderClearSourceRequest {
	source: string;
}

export interface ReminderAnnounceNowRequest {
	source?: string;
	id?: string;
}

export interface ReminderListRequest {
	source?: string;
	resolve: (snapshot: ReminderSnapshot) => void;
	reject?: (error: unknown) => void;
}

export interface ReminderRecord extends ReminderIntent {
	priority: number;
	display: boolean;
	ttl: ReminderTtl;
	createdAt: number;
	updatedAt: number;
}

export interface ReminderSnapshot {
	reminders: ReminderRecord[];
	count: number;
}

export interface RenderReminderInput {
	id: string;
	source: string;
	text: string;
	label?: string;
	priority: number;
	display?: boolean;
}
