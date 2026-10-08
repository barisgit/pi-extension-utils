import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { expect } from "./reminders-expect.ts";

const root = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
	files: string[];
	pi: { extensions: string[] };
};

// Pi Git installs run `git clean -fdx` and `npm install --omit=dev` without a build,
// so every Pi extension entry must be a tracked source file, and npm installs need it
// in the published `files` list.
describe("Pi extension manifest", () => {
	for (const entry of manifest.pi.extensions) {
		test(`${entry} is tracked by Git and published to npm`, () => {
			const tracked = execFileSync("git", ["ls-files", "--error-unmatch", entry], {
				cwd: root,
				encoding: "utf8",
			}).trim();
			expect(tracked).toBe(entry.replace(/^\.\//, ""));
			const published = manifest.files.some((pattern) => tracked === pattern || tracked.startsWith(`${pattern}/`));
			expect(published).toBe(true);
		});
	}
});
