import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/main/settings-store";

describe("settings", () => {
  it("uses privacy-preserving defaults", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      version: 5,
      hotkey: "F8",
      practiceHotkey: "Shift+F8",
      cancelHotkey: "ESC",
      transcriptionMode: "local",
      localModel: "base.en",
      refinementMode: "off",
      refinementProvider: "cerebras",
      pasteShortcutMode: "automatic",
    });
  });

  it("recovers from invalid persisted values", () => {
    expect(
      sanitizeSettings({ hotkey: "", transcriptionMode: "other", localModel: "large", soundsEnabled: false }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("preserves a valid Refinement provider and migrates missing values to Cerebras", () => {
    expect(sanitizeSettings({ refinementProvider: "openai" }).refinementProvider).toBe("openai");
    expect(sanitizeSettings({ version: 1 }).refinementProvider).toBe("cerebras");
  });

  it("preserves Azure transcription with either supported Refinement provider", () => {
    expect(sanitizeSettings({ transcriptionMode: "azure", refinementProvider: "openai", refinementMode: "light" })).toMatchObject({
      transcriptionMode: "azure", refinementProvider: "openai", refinementMode: "light",
    });
    expect(sanitizeSettings({ transcriptionMode: "cloud", refinementProvider: "openai" })).toMatchObject({
      transcriptionMode: "cloud", refinementProvider: "openai",
    });
    expect(sanitizeSettings({ transcriptionMode: "azure", refinementProvider: "cerebras" })).toMatchObject({
      transcriptionMode: "azure", refinementProvider: "cerebras",
    });
  });

  it.each(["off", "light", "medium"])("turns off saved Azure refinement (%s) without changing Azure transcription", (refinementMode) => {
    expect(sanitizeSettings({ transcriptionMode: "azure", refinementProvider: "azure", refinementMode })).toMatchObject({
      transcriptionMode: "azure", refinementProvider: "cerebras", refinementMode: "off",
    });
  });

  it("migrates older settings to automatic paste detection", () => {
    expect(sanitizeSettings({ version: 2, pasteShortcutMode: "invalid" })).toMatchObject({
      version: 5,
      pasteShortcutMode: "automatic",
      practiceHotkey: "Shift+F8",
      cancelHotkey: "ESC",
    });
    expect(sanitizeSettings({ pasteShortcutMode: "terminal" }).pasteShortcutMode).toBe("terminal");
    expect(sanitizeSettings({ pasteShortcutMode: "standard" }).pasteShortcutMode).toBe("standard");
  });

  it("migrates the old Refinement toggle to Light or Off", () => {
    expect(sanitizeSettings({ version: 3, refinementEnabled: true }).refinementMode).toBe("light");
    expect(sanitizeSettings({ version: 3, refinementEnabled: false }).refinementMode).toBe("off");
    expect(sanitizeSettings({ refinementMode: "medium" }).refinementMode).toBe("medium");
    expect(sanitizeSettings({ refinementMode: "invalid" }).refinementMode).toBe("off");
  });
});
