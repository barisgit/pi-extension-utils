import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { applyEdits, modify, parse as parseJsonc, printParseErrorCode, type JSONPath, type ParseError } from "jsonc-parser";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export type ConfigFormat = "json" | "jsonc";

export type DeepPartial<T> = T extends readonly unknown[]
	? T
	: T extends object
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T;

export interface DefineConfigOptions<Schema extends TSchema> {
	/** File basename, without .json/.jsonc. */
	name: string;
	/** Directory containing <name>.json or <name>.jsonc. Defaults to getAgentDir()/config. */
	dir?: string;
	/** TypeBox schema. Field defaults and descriptions are read from this schema. */
	schema: Schema;
}

export interface DefinedConfig<Schema extends TSchema> {
	readonly name: string;
	readonly schema: Schema;
	/** Return the resolved config path. If missing, returns the default .jsonc path. */
	path(): string;
	/** Ensure the config file exists, creating .jsonc with schema defaults/comments when missing. */
	ensure(): string;
	/** Ensure, load, apply schema defaults, validate, cache, and return config. */
	get(): Static<Schema>;
	/** Force a disk reread, replacing the cached value. */
	reload(): Static<Schema>;
	/** Patch config or mutate a draft; writes to disk and updates cache. */
	update(patch: DeepPartial<Static<Schema>> | ((draft: Static<Schema>) => void)): Static<Schema>;
}

interface ResolvedConfigPath {
	path: string;
	format: ConfigFormat;
	exists: boolean;
}

const FORMAT_OPTIONS = { insertSpaces: false, tabSize: 1, eol: "\n", insertFinalNewline: true };

export function defineConfig<Schema extends TSchema>(options: DefineConfigOptions<Schema>): DefinedConfig<Schema> {
	validateName(options.name);

	let cachedPath: ResolvedConfigPath | undefined;
	let cachedValue: Static<Schema> | undefined;

	const config: DefinedConfig<Schema> = {
		name: options.name,
		schema: options.schema,
		path() {
			return resolvePath().path;
		},
		ensure() {
			const resolved = resolvePath();
			if (!resolved.exists) {
				mkdirSync(configDir(), { recursive: true });
				writeFileSync(resolved.path, createInitialContent(options.schema, resolved.format));
				cachedPath = { ...resolved, exists: true };
			}
			return resolved.path;
		},
		get() {
			if (cachedValue !== undefined) return cloneJson(cachedValue) as Static<Schema>;
			return load(true);
		},
		reload() {
			cachedValue = undefined;
			cachedPath = undefined;
			return load(true);
		},
		update(patch) {
			const filePath = config.ensure();
			const resolved = resolvePath();
			const before = load(false);
			const draft = cloneJson(before) as Static<Schema>;
			if (typeof patch === "function") {
				(patch as (draft: Static<Schema>) => void)(draft);
			} else {
				mergeDeep(draft, patch);
			}
			const after = applyDefaultsAndValidate(options.schema, draft, resolved.path) as Static<Schema>;
			writeUpdatedConfig(filePath, resolved.format, before, after);
			cachedValue = cloneJson(after) as Static<Schema>;
			return cloneJson(after) as Static<Schema>;
		},
	};

	function configDir(): string {
		return options.dir ?? join(getAgentDir(), "config");
	}

	function resolvePath(): ResolvedConfigPath {
		if (cachedPath?.exists) return cachedPath;
		const dir = configDir();
		const jsoncPath = join(dir, `${options.name}.jsonc`);
		const jsonPath = join(dir, `${options.name}.json`);
		const hasJsonc = existsSync(jsoncPath);
		const hasJson = existsSync(jsonPath);
		if (hasJsonc && hasJson) {
			throw new Error(`Config '${options.name}' is ambiguous: both ${jsoncPath} and ${jsonPath} exist`);
		}
		cachedPath = hasJsonc
			? { path: jsoncPath, format: "jsonc", exists: true }
			: hasJson
				? { path: jsonPath, format: "json", exists: true }
				: { path: jsoncPath, format: "jsonc", exists: false };
		return cachedPath;
	}

	function load(ensure: boolean): Static<Schema> {
		if (ensure) config.ensure();
		const resolved = resolvePath();
		let parsed: unknown = {};
		if (resolved.exists || existsSync(resolved.path)) {
			parsed = readConfigFile(resolved.path, resolved.format);
		}
		const value = applyDefaultsAndValidate(options.schema, parsed, resolved.path) as Static<Schema>;
		cachedValue = cloneJson(value) as Static<Schema>;
		return cloneJson(value) as Static<Schema>;
	}

	return config;
}

function validateName(name: string): void {
	if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
		throw new Error(`Config name must be a filename base using letters, numbers, '.', '_' or '-': ${name}`);
	}
}

function readConfigFile(path: string, format: ConfigFormat): unknown {
	const text = readFileSync(path, "utf8");
	if (!text.trim()) return {};
	if (format === "json") return JSON.parse(text);

	const errors: ParseError[] = [];
	const parsed = parseJsonc(text, errors, { allowTrailingComma: true });
	if (errors.length > 0) {
		const first = errors[0]!;
		throw new Error(`Invalid JSONC in ${path} at offset ${first.offset}: ${printParseErrorCode(first.error)}`);
	}
	return parsed ?? {};
}

function applyDefaultsAndValidate(schema: TSchema, value: unknown, path: string): unknown {
	const defaults = defaultValue(schema as AnySchema);
	const merged = mergeDefaults(defaults.hasDefault ? defaults.value : {}, isPlainObject(value) ? value : value ?? {});
	Value.Default(schema, merged);
	if (!Value.Check(schema, merged)) {
		const details = [...Value.Errors(schema, merged)]
			.slice(0, 5)
			.map((error) => `${"path" in error && typeof error.path === "string" ? error.path : "/"} ${error.message}`)
			.join("; ");
		throw new Error(`Invalid config ${path}: ${details}`);
	}
	return merged;
}

function writeUpdatedConfig(path: string, format: ConfigFormat, before: unknown, after: unknown): void {
	if (format === "json") {
		writeFileSync(path, `${JSON.stringify(after, null, "\t")}\n`);
		return;
	}

	let text = readFileSync(path, "utf8");
	for (const diff of diffLeaves(before, after)) {
		const edits = modify(text, diff.path, diff.value, { formattingOptions: FORMAT_OPTIONS });
		text = applyEdits(text, edits);
	}
	writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
}

function createInitialContent(schema: TSchema, format: ConfigFormat): string {
	const typedSchema = schema as AnySchema;
	const defaults = defaultValue(typedSchema);
	const value = defaults.hasDefault ? defaults.value : typedSchema.type === "object" ? {} : null;
	if (format === "json") return `${JSON.stringify(value, null, "\t")}\n`;
	return `${stringifyJsoncWithComments(value, typedSchema, 0)}\n`;
}

function stringifyJsoncWithComments(value: unknown, schema: AnySchema, level: number): string {
	if (isPlainObject(value)) {
		const properties = isPlainObject(schema.properties) ? schema.properties as Record<string, AnySchema> : {};
		const keys = orderedKeys(value, properties);
		if (keys.length === 0) return "{}";
		const lines = ["{"];
		keys.forEach((key, index) => {
			const childSchema = properties[key] ?? {};
			const indent = "\t".repeat(level + 1);
			const description = typeof childSchema.description === "string" ? childSchema.description.trim() : "";
			if (description) {
				for (const line of description.split(/\r?\n/)) {
					lines.push(`${indent}// ${line.trim()}`);
				}
			}
			const rendered = stringifyJsoncWithComments((value as Record<string, unknown>)[key], childSchema, level + 1);
			lines.push(`${indent}${JSON.stringify(key)}: ${rendered}${index === keys.length - 1 ? "" : ","}`);
		});
		lines.push(`${"\t".repeat(level)}}`);
		return lines.join("\n");
	}
	return JSON.stringify(value, null, "\t");
}

function orderedKeys(value: unknown, properties: Record<string, AnySchema>): string[] {
	const object = value as Record<string, unknown>;
	const keys = new Set([...Object.keys(properties), ...Object.keys(object)]);
	return [...keys].filter((key) => Object.prototype.hasOwnProperty.call(object, key));
}

interface DefaultResult {
	hasDefault: boolean;
	value: unknown;
}

type AnySchema = TSchema & Record<string, unknown>;

function defaultValue(schema: AnySchema): DefaultResult {
	if (Object.prototype.hasOwnProperty.call(schema, "default")) {
		return { hasDefault: true, value: cloneJson(schema.default) };
	}
	if (schema.type === "object" && isPlainObject(schema.properties)) {
		const value: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(schema.properties)) {
			const childDefault = defaultValue(child as AnySchema);
			if (childDefault.hasDefault) value[key] = childDefault.value;
		}
		return Object.keys(value).length > 0 ? { hasDefault: true, value } : { hasDefault: false, value: undefined };
	}
	return { hasDefault: false, value: undefined };
}

function mergeDefaults(defaults: unknown, value: unknown): unknown {
	if (isPlainObject(defaults) && isPlainObject(value)) {
		const merged: Record<string, unknown> = { ...cloneJson(defaults) as Record<string, unknown> };
		for (const [key, childValue] of Object.entries(value)) {
			merged[key] = Object.prototype.hasOwnProperty.call(merged, key)
				? mergeDefaults(merged[key], childValue)
				: childValue;
		}
		return merged;
	}
	return value === undefined ? cloneJson(defaults) : value;
}

function mergeDeep(target: unknown, patch: unknown): void {
	if (!isPlainObject(target) || !isPlainObject(patch)) return;
	for (const [key, value] of Object.entries(patch)) {
		if (isPlainObject(value) && isPlainObject((target as Record<string, unknown>)[key])) {
			mergeDeep((target as Record<string, unknown>)[key], value);
		} else {
			(target as Record<string, unknown>)[key] = cloneJson(value);
		}
	}
}

interface LeafDiff {
	path: JSONPath;
	value: unknown;
}

function diffLeaves(before: unknown, after: unknown, path: JSONPath = []): LeafDiff[] {
	if (isPlainObject(before) && isPlainObject(after)) {
		const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
		return [...keys].flatMap((key) => diffLeaves(before[key], after[key], [...path, key]));
	}
	if (JSON.stringify(before) === JSON.stringify(after)) return [];
	return [{ path, value: after }];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
	return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
