import assert from "node:assert/strict";

export function expect<T>(actual: T) {
	return {
		toBe(expected: unknown): void {
			assert.equal(actual, expected);
		},
		toEqual(expected: unknown): void {
			assert.deepEqual(actual, expected);
		},
		toMatchObject(expected: unknown): void {
			assert.partialDeepStrictEqual(actual, expected);
		},
		toBeNull(): void {
			assert.equal(actual, null);
		},
		toBeUndefined(): void {
			assert.equal(actual, undefined);
		},
		toBeDefined(): void {
			assert.notEqual(actual, undefined);
		},
		toHaveLength(expected: number): void {
			assert.equal((actual as { length: number }).length, expected);
		},
		toContain(expected: string): void {
			assert.equal(String(actual).includes(expected), true);
		},
		toMatch(expected: RegExp): void {
			assert.match(String(actual), expected);
		},
		get not() {
			return {
				toBe(expected: unknown): void {
					assert.notEqual(actual, expected);
				},
				toBeNull(): void {
					assert.notEqual(actual, null);
				},
				toContain(expected: string): void {
					assert.equal(String(actual).includes(expected), false);
				},
			};
		},
	};
}
