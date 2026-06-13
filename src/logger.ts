import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface LoggerOptions {
	dir?: string;
	maxBytes?: number;
}

export interface Logger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	log(level: string, message: string): void;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;

export function createLogger(ns: string, opts: LoggerOptions = {}): Logger {
	if (!ns || ns.includes("/") || ns.includes("\\")) {
		throw new Error("Logger namespace must not contain path separators");
	}
	const dir = opts.dir ?? join(getAgentDir(), "log");
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
	const file = join(dir, `${ns}.log`);
	mkdirSync(dirname(file), { recursive: true });

	function rotateIfNeeded(nextBytes: number): void {
		if (maxBytes <= 0 || !existsSync(file)) return;
		const size = statSync(file).size;
		if (size + nextBytes <= maxBytes) return;
		const rotated = `${file}.1`;
		if (existsSync(rotated)) rmSync(rotated);
		renameSync(file, rotated);
	}

	function log(level: string, message: string): void {
		const line = `${new Date().toISOString()} ${level} ${message}\n`;
		mkdirSync(dirname(file), { recursive: true });
		rotateIfNeeded(Buffer.byteLength(line));
		appendFileSync(file, line);
	}

	return {
		debug(message) {
			log("debug", message);
		},
		info(message) {
			log("info", message);
		},
		warn(message) {
			log("warn", message);
		},
		error(message) {
			log("error", message);
		},
		log,
	};
}
