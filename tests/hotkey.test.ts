import { describe, expect, it } from "vitest";
import {
  hotkeysEquivalent,
  InvalidHotkeyError,
  normalizeConfiguredHotkeys,
  normalizeHotkey,
} from "../src/main/core/hotkey";

describe("global hotkey validation", () => {
  it.each([
    ["f8", "F8"],
    [" alt + ctrl + d ", "Control+Alt+D"],
    ["meta+shift+f12", "Shift+Super+F12"],
    ["CmdOrCtrl+Enter", "CommandOrControl+Return"],
    ["Ctrl+Plus", "Control+Plus"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeHotkey(input)).toBe(expected);
  });

  it("compares aliases, case, and modifier order semantically", () => {
    expect(hotkeysEquivalent("Ctrl+Alt+D", "alt+CONTROL+d")).toBe(true);
    expect(hotkeysEquivalent("Enter", "return")).toBe(true);
    expect(hotkeysEquivalent("Ctrl+D", "Alt+D")).toBe(false);
  });

  it.each(["", "Ctrl+", "Ctrl+Alt", "Ctrl+A+B", "Ctrl+Ctrl+A", "F25", "Hyper+D", "Command+D", "Option+D"])(
    "rejects malformed accelerator %j",
    (input) => expect(() => normalizeHotkey(input)).toThrow(InvalidHotkeyError),
  );

  it("accepts the configurable Practice and cancellation defaults", () => {
    expect(normalizeHotkey("SHIFT + F8")).toBe("Shift+F8");
    expect(normalizeHotkey("ESC")).toBe("Escape");
  });

  it.each([
    { hotkey: "F8", practiceHotkey: "f8", cancelHotkey: "Escape" },
    { hotkey: "F8", practiceHotkey: "Esc", cancelHotkey: "Escape", extra: "ignored" },
  ])("rejects shortcuts assigned to more than one action", (bindings) => {
    expect(() => normalizeConfiguredHotkeys(bindings)).toThrow("already assigned");
  });
});
