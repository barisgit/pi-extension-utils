import { describe, test } from "node:test";
import { expect } from "./reminders-expect.ts";

import { registerReminderHost } from "../src/reminders/host.ts";
import { REMINDER_MESSAGE_CUSTOM_TYPE } from "../src/reminders/types.ts";

interface RenderedComponent {
	render(width: number): string[];
	invalidate(): void;
}

type MessageRenderer = (message: unknown, options: unknown, theme: unknown) => RenderedComponent;

/** Register the reminder host against a minimal Pi stub and return its message renderer. */
function registeredRenderer(): MessageRenderer {
	const renderers = new Map<string, MessageRenderer>();
	const pi = {
		events: { on() {} },
		on() {},
		registerCommand() {},
		registerMessageRenderer(type: string, renderer: MessageRenderer) {
			renderers.set(type, renderer);
		},
	};
	registerReminderHost(pi as never);

	const renderer = renderers.get(REMINDER_MESSAGE_CUSTOM_TYPE);
	if (!renderer) throw new Error("reminder message renderer was not registered");
	return renderer;
}

/**
 * Theme stub that tags styled text with the current palette name and counts styling calls,
 * mirroring Pi's live theme object whose colors change in place on theme switches.
 */
function countingTheme() {
	const theme = {
		palette: "dark",
		calls: 0,
		fg(color: string, value: string): string {
			theme.calls += 1;
			return `<${theme.palette}:${color}>${value}</>`;
		},
	};
	return theme;
}

const largeReminder = {
	customType: REMINDER_MESSAGE_CUSTOM_TYPE,
	content: "<system-reminder>\nunused model body\n</system-reminder>",
	display: true,
	details: {
		reminderCount: 2,
		sources: ["charter", "dcp"],
		displayText: Array.from({ length: 200 }, (_, index) => `Objective ${index}: keep the charter objective visible in full`).join("\n"),
	},
};

describe("reminder message renderer", () => {
	test("repeated renders at the same width reuse the laid-out lines", () => {
		const theme = countingTheme();
		const component = registeredRenderer()(largeReminder, {}, theme);

		const first = component.render(80);
		const callsAfterFirstRender = theme.calls;
		const second = component.render(80);

		expect(second).toEqual(first);
		expect(theme.calls).toBe(callsAfterFirstRender);
		expect(first.join("\n")).toContain("Objective 199: keep the charter objective visible in full");
	});

	test("width changes re-layout to match a fresh render at that width", () => {
		const renderer = registeredRenderer();
		const component = renderer(largeReminder, {}, countingTheme());

		const wide = component.render(120);
		const narrow = component.render(40);

		expect(narrow).toEqual(renderer(largeReminder, {}, countingTheme()).render(40));
		expect(narrow.length > wide.length).toBe(true);
		expect(component.render(120)).toEqual(wide);
		for (const width of [0, 1, 2, 3]) {
			expect(component.render(width)).toEqual(renderer(largeReminder, {}, countingTheme()).render(width));
		}
	});

	test("invalidate re-renders with the current theme colors", () => {
		const theme = countingTheme();
		const component = registeredRenderer()(largeReminder, {}, theme);
		expect(component.render(80)[0]).toContain("<dark:accent>");

		theme.palette = "light";
		component.invalidate();
		const lines = component.render(80);

		expect(lines[0]).toContain("<light:accent>");
		expect(lines.join("\n")).not.toContain("<dark:");
	});
});
