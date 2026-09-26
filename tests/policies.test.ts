import { describe, expect, it } from "vitest";
import {
  parseWindowClass,
  pasteShortcutFor,
  shouldRestoreClipboard,
} from "../src/main/core/delivery-policy";
import { MODEL_CATALOG } from "../src/main/model-catalog";

describe("delivery policy", () => {
  it("restores only when the clipboard still contains our transcript", () => {
    expect(shouldRestoreClipboard("dictated text", "dictated text")).toBe(true);
    expect(shouldRestoreClipboard("new user copy", "dictated text")).toBe(false);
  });

  it("uses the terminal paste shortcut for GNOME Terminal automatically", () => {
    expect(pasteShortcutFor("automatic", "Gnome-terminal")).toBe("ctrl+shift+v");
    expect(pasteShortcutFor("automatic", "GNOME-TERMINAL-SERVER")).toBe("ctrl+shift+v");
  });

  it("reads the application class from an X11 WM_CLASS property", () => {
    expect(
      parseWindowClass('WM_CLASS(STRING) = "gnome-terminal-server", "Gnome-terminal"'),
    ).toBe("Gnome-terminal");
    expect(parseWindowClass("WM_CLASS:  not found.")).toBeUndefined();
  });

  it("uses the standard shortcut for an unknown application automatically", () => {
    expect(pasteShortcutFor("automatic", "firefox")).toBe("ctrl+v");
    expect(pasteShortcutFor("automatic", undefined)).toBe("ctrl+v");
  });

  it("honors an explicit paste shortcut override", () => {
    expect(pasteShortcutFor("terminal", "firefox")).toBe("ctrl+shift+v");
    expect(pasteShortcutFor("standard", "Gnome-terminal")).toBe("ctrl+v");
  });
});

describe("model catalog", () => {
  it("pins immutable revisions and SHA-256 digests", () => {
    for (const model of Object.values(MODEL_CATALOG)) {
      expect(model.url).toContain("5359861c739e955e79d9a303bcbc70fb988958b1");
      expect(model.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
