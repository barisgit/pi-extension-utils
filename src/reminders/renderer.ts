import type { RenderReminderInput } from "./types.ts";

const SOURCE_LABELS: Record<string, string> = {
	"pi-dag-tasks": "Tasks",
	tasks: "Tasks",
	dcp: "DCP",
	"pi-dynamic-context-pruning": "DCP",
	"pi-subagents": "Subagents",
	subagents: "Subagents",
};

interface ReminderGroup {
	label: string;
	source: string;
	maxPriority: number;
	reminders: RenderReminderInput[];
}

/** Render reminders into one compact model-visible trailer. */
export function renderReminderTrailer(reminders: readonly RenderReminderInput[]): string | null {
	const body = renderReminderBody(reminders);
	return body ? `<system-reminder>\n${body}\n</system-reminder>` : null;
}

/** Render reminders without wrapper tags for custom chat display. */
export function renderReminderBody(reminders: readonly RenderReminderInput[]): string | null {
	const normalized = reminders
		.map((reminder) => ({
			...reminder,
			text: sanitizeText(reminder.text),
			label: deriveLabel(reminder.source, reminder.label),
		}))
		.filter((reminder) => reminder.text.length > 0);

	if (normalized.length === 0) return null;

	const groups = buildGroups(normalized);
	return groups.map((group) => renderGroup(group)).join("\n");
}

export function sanitizeText(text: string): string {
	return escapeWrapperText(text.trim().replace(/\s+/g, " "));
}

export function deriveLabel(source: string, label?: string): string {
	const explicit = sanitizeLabel(label ?? "");
	if (explicit.length > 0) return explicit;

	const mapped = SOURCE_LABELS[source.trim().toLowerCase()];
	if (mapped) return mapped;

	const fallback = source
		.trim()
		.replace(/^pi[-_]/i, "")
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join("");
	return sanitizeLabel(fallback || "Reminder");
}

function buildGroups(reminders: RenderReminderInput[]): ReminderGroup[] {
	const byLabel = new Map<string, ReminderGroup>();

	for (const reminder of reminders) {
		const label = deriveLabel(reminder.source, reminder.label);
		const key = label.toLowerCase();
		const existing = byLabel.get(key);
		if (existing) {
			existing.maxPriority = Math.max(existing.maxPriority, reminder.priority);
			existing.reminders.push(reminder);
			if (reminder.source < existing.source) existing.source = reminder.source;
		} else {
			byLabel.set(key, {
				label,
				source: reminder.source,
				maxPriority: reminder.priority,
				reminders: [reminder],
			});
		}
	}

	return [...byLabel.values()]
		.map((group) => ({
			...group,
			reminders: [...group.reminders].sort(compareReminders),
		}))
		.sort(compareGroups);
}

function renderGroup(group: ReminderGroup): string {
	const text = group.reminders.map((reminder) => reminder.text).join("; ");
	return `${group.label}: ${text}`;
}

function compareGroups(a: ReminderGroup, b: ReminderGroup): number {
	return b.maxPriority - a.maxPriority || a.label.localeCompare(b.label) || a.source.localeCompare(b.source);
}

function compareReminders(a: RenderReminderInput, b: RenderReminderInput): number {
	return b.priority - a.priority || a.id.localeCompare(b.id);
}

function sanitizeLabel(label: string): string {
	return label
		.trim()
		.replace(/[^A-Za-z0-9_-]+/g, "")
		.slice(0, 24);
}

function escapeWrapperText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
