import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, test } from "node:test";
import { Type } from "typebox";
import { defineConfig } from "../src/index.ts";
import { expect } from "./reminders-expect.ts";

const schema = Type.Object({
	feature: Type.Object({
		enabled: Type.Boolean({
			default: false,
			description: "Enable the feature.",
		}),
		count: Type.Number({
			default: 1,
			description: "Number of things.",
		}),
	}, {
		description: "Feature settings.",
	}),
});

describe("defineConfig", () => {
	function tempDir(): string {
		return mkdtempSync(join(tmpdir(), "pi-utils-config-test-"));
	}

	test("get creates jsonc config with schema defaults and comments", () => {
		const dir = tempDir();
		try {
			const config = defineConfig({ name: "demo", dir, schema });
			const value = config.get();
			expect(value).toEqual({ feature: { enabled: false, count: 1 } });
			expect(config.path()).toBe(join(dir, "demo.jsonc"));
			const text = readFileSync(config.path(), "utf8");
			expect(text).toContain("// Feature settings.");
			expect(text).toContain("// Enable the feature.");
			expect(text).toContain('"enabled": false');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("path does not lock a missing jsonc file before json is created", () => {
		const dir = tempDir();
		try {
			const config = defineConfig({ name: "demo", dir, schema });
			expect(config.path()).toBe(join(dir, "demo.jsonc"));
			writeFileSync(join(dir, "demo.json"), JSON.stringify({ feature: { enabled: true } }));
			expect(config.get()).toEqual({ feature: { enabled: true, count: 1 } });
			expect(config.path()).toBe(join(dir, "demo.json"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("loads strict json when only json exists", () => {
		const dir = tempDir();
		try {
			writeFileSync(join(dir, "demo.json"), JSON.stringify({ feature: { count: 4 } }));
			const config = defineConfig({ name: "demo", dir, schema });
			expect(config.get()).toEqual({ feature: { enabled: false, count: 4 } });
			expect(config.path()).toBe(join(dir, "demo.json"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("throws when json and jsonc both exist", () => {
		const dir = tempDir();
		try {
			writeFileSync(join(dir, "demo.json"), "{}");
			writeFileSync(join(dir, "demo.jsonc"), "{}");
			const config = defineConfig({ name: "demo", dir, schema });
			expect(() => config.get()).toThrow(/ambiguous/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("update preserves jsonc comments while changing values", () => {
		const dir = tempDir();
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "demo.jsonc"), `{
	// keep this comment
	"feature": {
		// keep nested comment
		"enabled": false,
		"count": 1
	}
}
`);
			const config = defineConfig({ name: "demo", dir, schema });
			const value = config.update((draft) => {
				draft.feature.enabled = true;
				draft.feature.count = 5;
			});
			expect(value).toEqual({ feature: { enabled: true, count: 5 } });
			const text = readFileSync(config.path(), "utf8");
			expect(text).toContain("// keep this comment");
			expect(text).toContain("// keep nested comment");
			expect(text).toContain('"enabled": true');
			expect(text).toContain('"count": 5');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("get returns cached clones and reload sees disk edits", () => {
		const dir = tempDir();
		try {
			const config = defineConfig({ name: "demo", dir, schema });
			const first = config.get();
			first.feature.enabled = true;
			expect(config.get()).toEqual({ feature: { enabled: false, count: 1 } });
			writeFileSync(config.path(), JSON.stringify({ feature: { enabled: true, count: 9 } }));
			expect(config.get()).toEqual({ feature: { enabled: false, count: 1 } });
			expect(config.reload()).toEqual({ feature: { enabled: true, count: 9 } });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
