import { Type, type Static } from "typebox";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = typeof LOG_LEVELS[number];
export type LoggerLevel = LogLevel | "silent";

export const loggerLevelSchema = Type.Union([
	Type.Literal("debug"),
	Type.Literal("info"),
	Type.Literal("warn"),
	Type.Literal("error"),
	Type.Literal("silent"),
], {
	default: "info",
	description: "Minimum log level to write.",
});

export const loggingConfigSchema = Type.Object({
	level: loggerLevelSchema,
	maxFiles: Type.Number({
		default: 3,
		minimum: 0,
		description: "Number of rotated log files to retain.",
	}),
	maxBytes: Type.Number({
		default: 1048576,
		minimum: 0,
		description: "Rotate a log file when it grows beyond this many bytes. Use 0 to disable rotation.",
	}),
}, {
	description: "Default logger settings used when createLogger() options omit a value.",
});

export type LoggingConfig = Static<typeof loggingConfigSchema>;
