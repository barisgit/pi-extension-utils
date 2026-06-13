import { Type, type Static } from "typebox";

export const remindersConfigSchema = Type.Object({
	debugShowAllInTui: Type.Boolean({
		default: false,
		description: "Show reminders with display:false in the transcript UI for debugging.",
	}),
}, {
	description: "Reminder host settings.",
});

export type RemindersConfig = Static<typeof remindersConfigSchema>;
