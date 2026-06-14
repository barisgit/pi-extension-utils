import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readUtilsConfigOrDefaults } from "../utils-config.ts";
import { LOG_LEVELS, type LoggerLevel, type LogLevel } from "./config.ts";

export { LOG_LEVELS, loggerLevelSchema, loggingConfigSchema, type LoggerLevel, type LoggingConfig, type LogLevel } from "./config.ts";

export interface LoggerOptions {
	dir?: string;
	maxBytes?: number;
	/** Number of rotated files to retain: name.jsonl.1, name.jsonl.2, ... */
	maxFiles?: number;
	/** Minimum level to write. Defaults to utilsConfig.logging.level. */
	level?: LoggerLevel;
}

export type LoggerFields = Record<string, unknown>;

export interface Logger {
	debug(message: string, fields?: LoggerFields): void;
	info(message: string, fields?: LoggerFields): void;
	warn(message: string, fields?: LoggerFields): void;
	error(message: string, fields?: LoggerFields): void;
	log(level: LogLevel, message: string, fields?: LoggerFields): void;
	setLevel(level: LoggerLevel): void;
	isEnabled(level: LogLevel): boolean;
}

export interface LoggerRecord {
	ts: string;
	level: LogLevel;
	message: string;
	[field: string]: unknown;
}

const RESERVED_RECORD_FIELDS = new Set(["ts", "level", "message"]);

const LEVEL_WEIGHT: Record<LoggerLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	silent: Number.POSITIVE_INFINITY,
};

export function createLogger(name: string, opts: LoggerOptions = {}): Logger {
	if (!name || name.includes("/") || name.includes("\\")) {
		throw new Error("Logger name must not contain path separators");
	}
	const configured = opts.level === undefined || opts.maxBytes === undefined || opts.maxFiles === undefined
		? readUtilsConfigOrDefaults().logging
		: undefined;
	const dir = opts.dir ?? join(getAgentDir(), "log");
	const maxBytes = Math.max(0, Math.floor(opts.maxBytes ?? configured?.maxBytes ?? 1024 * 1024));
	const maxFiles = Math.max(0, Math.floor(opts.maxFiles ?? configured?.maxFiles ?? 3));
	let level = opts.level ?? configured?.level ?? "info";
	const file = join(dir, `${name}.jsonl`);
	mkdirSync(dirname(file), { recursive: true });

	function rotateIfNeeded(nextBytes: number): void {
		if (maxBytes <= 0 || !existsSync(file)) return;
		const size = statSync(file).size;
		if (size + nextBytes <= maxBytes) return;
		if (maxFiles <= 0) {
			rmSync(file);
			return;
		}
		const oldest = `${file}.${maxFiles}`;
		if (existsSync(oldest)) rmSync(oldest);
		for (let index = maxFiles - 1; index >= 1; index--) {
			const from = `${file}.${index}`;
			if (existsSync(from)) renameSync(from, `${file}.${index + 1}`);
		}
		renameSync(file, `${file}.1`);
	}

	function isEnabled(candidate: LogLevel): boolean {
		return LEVEL_WEIGHT[candidate] >= LEVEL_WEIGHT[level];
	}

	function log(candidate: LogLevel, message: string, fields: LoggerFields = {}): void {
		if (!isEnabled(candidate)) return;
		const record: LoggerRecord = { ts: new Date().toISOString(), level: candidate, message };
		for (const [key, value] of Object.entries(fields)) {
			if (!RESERVED_RECORD_FIELDS.has(key)) record[key] = value;
		}
		const line = `${JSON.stringify(record)}\n`;
		mkdirSync(dirname(file), { recursive: true });
		rotateIfNeeded(Buffer.byteLength(line));
		appendFileSync(file, line);
	}

	return {
		debug(message, fields) {
			log("debug", message, fields);
		},
		info(message, fields) {
			log("info", message, fields);
		},
		warn(message, fields) {
			log("warn", message, fields);
		},
		error(message, fields) {
			log("error", message, fields);
		},
		log,
		setLevel(nextLevel) {
			level = nextLevel;
		},
		isEnabled,
	};
}
