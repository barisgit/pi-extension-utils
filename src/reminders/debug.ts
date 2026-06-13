import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { deriveLabel } from "./renderer.ts";
import type { ReminderSnapshot } from "./types.ts";

const DEBUG_LOG_PATH = join(getAgentDir(), "log", "reminders.jsonl");

export interface ReminderCacheDiagnosticsInput {
	payload?: unknown;
	resultPayload?: unknown;
	snapshot: ReminderSnapshot;
	trailer: string | null;
	inserted: boolean;
	skippedReason?: string;
	providerApi?: string;
	strategy?: string;
	adapterName?: string;
}

export interface ReminderCacheDiagnostics {
	event: "reminder_cache_diagnostics";
	timestamp: string;
	inserted: boolean;
	skippedReason?: string;
	providerApi?: string;
	strategy?: string;
	adapterName?: string;
	payloadShape: "messages" | "input" | "unsupported";
	messagesBefore: number | null;
	messagesAfter: number | null;
	activeReminderCount: number;
	activeReminderSources: string[];
	activeReminderLabels: string[];
	trailerChars: number;
	trailerHash: string | null;
	stablePrefixHash: string | null;
	cacheControlBeforeCount: number;
	cacheControlBeforePaths: string[];
	cacheControlInOrAfterTrailerCount: number;
	cacheControlInOrAfterTrailerPaths: string[];
}

export function buildReminderCacheDiagnostics(input: ReminderCacheDiagnosticsInput): ReminderCacheDiagnostics {
	const before = getProviderMessages(input.payload);
	const after = getProviderMessages(input.resultPayload);
	const messagesBefore = before.messages;
	const messagesAfter = after.messages;
	const trailerMessage = input.inserted && messagesAfter ? messagesAfter[messagesAfter.length - 1] : undefined;
	const trailerPath = after.shape === "input" ? "input[-1]" : "messages[-1]";
	const cacheControlBeforePaths = findCacheControlPaths(messagesBefore ?? input.payload, before.path);
	const cacheControlInOrAfterTrailerPaths = trailerMessage ? findCacheControlPaths(trailerMessage, trailerPath) : [];
	const sources = uniqueSorted(input.snapshot.reminders.map((reminder) => reminder.source));
	const labels = uniqueSorted(input.snapshot.reminders.map((reminder) => deriveLabel(reminder.source, reminder.label)));

	return {
		event: "reminder_cache_diagnostics",
		timestamp: new Date().toISOString(),
		inserted: input.inserted,
		skippedReason: input.skippedReason,
		providerApi: input.providerApi,
		strategy: input.strategy,
		adapterName: input.adapterName,
		payloadShape: before.shape,
		messagesBefore: messagesBefore?.length ?? null,
		messagesAfter: messagesAfter?.length ?? null,
		activeReminderCount: input.snapshot.count,
		activeReminderSources: sources,
		activeReminderLabels: labels,
		trailerChars: input.trailer?.length ?? 0,
		trailerHash: input.trailer ? hashString(input.trailer) : null,
		stablePrefixHash: messagesBefore ? hashJson(messagesBefore) : null,
		cacheControlBeforeCount: cacheControlBeforePaths.length,
		cacheControlBeforePaths,
		cacheControlInOrAfterTrailerCount: cacheControlInOrAfterTrailerPaths.length,
		cacheControlInOrAfterTrailerPaths,
	};
}

export function writeReminderCacheDiagnostics(diagnostics: ReminderCacheDiagnostics): void {
	writeReminderDiagnostic({ ...diagnostics });
}

export function writeReminderDiagnostic(record: Record<string, unknown>): void {
	try {
		const path = process.env.PI_REMINDERS_DEBUG_LOG || DEBUG_LOG_PATH;
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, `${JSON.stringify({ timestamp: new Date().toISOString(), ...record })}\n`, "utf8");
	} catch {
		// Debug logging is best-effort and must not affect provider requests.
	}
}

function getProviderMessages(payload: unknown): {
	shape: "messages" | "input" | "unsupported";
	path: "messages" | "input";
	messages: unknown[] | null;
} {
	if (!isRecord(payload)) return { shape: "unsupported", path: "messages", messages: null };
	if (Array.isArray(payload.messages)) return { shape: "messages", path: "messages", messages: payload.messages };
	if (Array.isArray(payload.input)) return { shape: "input", path: "input", messages: payload.input };
	return { shape: "unsupported", path: "messages", messages: null };
}

function findCacheControlPaths(value: unknown, prefix = "messages"): string[] {
	const paths: string[] = [];
	visit(value, prefix, paths);
	return paths;
}

function visit(value: unknown, path: string, paths: string[]): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) => visit(item, `${path}[${index}]`, paths));
		return;
	}

	if (!isRecord(value)) return;

	for (const [key, child] of Object.entries(value)) {
		const childPath = `${path}.${key}`;
		if (key === "cache_control") paths.push(childPath);
		visit(child, childPath, paths);
	}
}

function hashJson(value: unknown): string {
	return hashString(stableStringify(value));
}

function hashString(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}
