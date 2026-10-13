import { type KeybindingsManager, matchesKey } from "@earendil-works/pi-tui";

type MatchKey = Parameters<typeof matchesKey>[1];

export type KeyBinding = string | readonly string[];

export interface ExtraKeyBinding {
	keys: KeyBinding;
	handler: () => void;
}

export interface NavKeyHandlers {
	/** Host selection bindings; explicit pane shortcuts remain local. */
	keybindings?: Partial<Pick<KeybindingsManager, "matches">>;
	close?: () => void;
	focusToggle?: () => void;
	move?: (delta: 1 | -1) => void;
	page?: (delta: 1 | -1) => void;
	home?: () => void;
	end?: () => void;
	/** Defaults to escape + ctrl+c. Add "q" for dashboard-style close. */
	closeKeys?: readonly string[];
	/** Keys consumed without invoking a handler. */
	bannedKeys?: readonly string[];
	/** Consumer-specific bindings checked after close keys and before banned/common nav keys. */
	extraBindings?: readonly ExtraKeyBinding[];
}

const DEFAULT_CLOSE_KEYS = ["escape", "ctrl+c"] as const;

/** Dispatch common fullscreen navigation keys using pi-tui `matchesKey` semantics. */
export function dispatchNavKeys(data: string, handlers: NavKeyHandlers): boolean {
	const selectMatches = (action: "tui.select.up" | "tui.select.down" | "tui.select.pageUp" | "tui.select.pageDown" | "tui.select.cancel", fallback: string) =>
		handlers.keybindings?.matches ? handlers.keybindings.matches(data, action) : matchesAny(data, fallback);
	const closeKeys = handlers.closeKeys ?? DEFAULT_CLOSE_KEYS;
	if (matchesAny(data, closeKeys.filter((key) => key !== "escape")) || (closeKeys.includes("escape") && selectMatches("tui.select.cancel", "escape"))) {
		handlers.close?.();
		return true;
	}
	for (const binding of handlers.extraBindings ?? []) {
		if (matchesAny(data, binding.keys)) {
			binding.handler();
			return true;
		}
	}
	if (matchesAny(data, handlers.bannedKeys ?? [])) return true;
	if (matchesAny(data, ["tab"])) {
		handlers.focusToggle?.();
		return true;
	}
	if ((matchesAny(data, "j") || selectMatches("tui.select.down", "down"))) {
		handlers.move?.(1);
		return true;
	}
	if ((matchesAny(data, "k") || selectMatches("tui.select.up", "up"))) {
		handlers.move?.(-1);
		return true;
	}
	if (selectMatches("tui.select.pageDown", "pageDown")) {
		handlers.page?.(1);
		return true;
	}
	if (selectMatches("tui.select.pageUp", "pageUp")) {
		handlers.page?.(-1);
		return true;
	}
	if (matchesAny(data, ["home", "g"])) {
		handlers.home?.();
		return true;
	}
	if (matchesAny(data, ["end", "shift+g"])) {
		handlers.end?.();
		return true;
	}
	return false;
}

function matchesAny(data: string, binding: KeyBinding): boolean {
	const keys = typeof binding === "string" ? [binding] : binding;
	return keys.some((key) => data === key || matchesKey(data, key as MatchKey));
}
