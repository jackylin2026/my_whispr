import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DictationController } from "../src/main/controller";
import { DeliveryService } from "../src/main/delivery";
import { ModelManager } from "../src/main/model-manager";
import { PracticeSession } from "../src/main/practice-session";
import { PracticePromptStore } from "../src/main/practice-prompt-store";
import { RefinementPromptStore } from "../src/main/refinement-prompt-store";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/main/settings-store";
import { TempFiles } from "../src/main/temp-files";
import type { AppState, Settings } from "../src/shared/types";

const shortcut = vi.hoisted(() => ({
  register: vi.fn<(accelerator: string, callback: () => void) => boolean>(() => true),
  unregister: vi.fn<(accelerator: string) => void>(),
  unregisterAll: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {},
  clipboard: {},
  ClipboardItem: class {},
  globalShortcut: shortcut,
}));

beforeEach(() => {
  vi.clearAllMocks();
  shortcut.register.mockReturnValue(true);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(current: Settings = { ...DEFAULT_SETTINGS, hotkey: "F8" }, onState?: (state: AppState) => void) {
  const store = new SettingsStore("/unused/settings.json");
  vi.spyOn(store, "get").mockReturnValue(current);
  vi.spyOn(store, "load").mockResolvedValue(current);
  const update = vi.spyOn(store, "update").mockImplementation(async (patch) => ({ ...current, ...patch }));
  const models = new ModelManager("/unused/models");
  vi.spyOn(models, "states").mockResolvedValue([]);
  vi.spyOn(models, "isInstalled").mockResolvedValue(false);
  const tempFiles = new TempFiles("/unused/audio");
  vi.spyOn(tempFiles, "purge").mockResolvedValue();
  const settingsWindow = { show: vi.fn(), focus: vi.fn(), webContents: { send: vi.fn() } };
  const overlayWindow = { show: vi.fn(), focus: vi.fn(), hide: vi.fn(), webContents: { send: vi.fn() } };
  const controller = new DictationController(
    {
      settings: settingsWindow as unknown as BrowserWindow,
      overlay: overlayWindow as unknown as BrowserWindow,
    },
    store,
    models,
    tempFiles,
    new DeliveryService(),
    new RefinementPromptStore("/unused/prompts", { light: "Light", medium: "Medium" }),
    new PracticeSession(),
    new PracticePromptStore("/unused/prompts", { grammar: "Grammar", pronunciation: "Pronunciation" }),
    "/unused/whisper-server",
    onState,
  );
  return { controller, store, update, settingsWindow };
}

describe("global hotkey replacement", () => {
  it("grabs and persists the new shortcut before releasing the old one", async () => {
    const { controller, update } = setup();

    await controller.updateSettings({ hotkey: " alt + ctrl + d " });

    expect(shortcut.register).toHaveBeenCalledWith("Control+Alt+D", expect.any(Function));
    expect(update).toHaveBeenCalledWith({ hotkey: "Control+Alt+D" });
    expect(shortcut.unregister).toHaveBeenCalledWith("F8");
    expect(shortcut.register.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(shortcut.unregister.mock.invocationCallOrder[0]);
  });

  it("keeps the old shortcut and setting when the X11 grab fails", async () => {
    const { controller, update } = setup();
    shortcut.register.mockReturnValue(false);

    await expect(controller.updateSettings({ hotkey: "Ctrl+Alt+D" })).rejects.toThrow("already in use or unavailable");

    expect(update).not.toHaveBeenCalled();
    expect(shortcut.unregister).not.toHaveBeenCalled();
  });

  it("releases the proposed shortcut and keeps the old one when persistence fails", async () => {
    const { controller, update } = setup();
    update.mockRejectedValue(new Error("disk full"));

    await expect(controller.updateSettings({ hotkey: "Ctrl+Alt+D" })).rejects.toThrow("disk full");

    expect(shortcut.unregister).toHaveBeenCalledTimes(1);
    expect(shortcut.unregister).toHaveBeenCalledWith("Control+Alt+D");
    expect(shortcut.unregister).not.toHaveBeenCalledWith("F8");
  });

  it("does not re-grab an equivalent spelling of the current shortcut", async () => {
    const current = { ...DEFAULT_SETTINGS, hotkey: "Control+Alt+D" };
    const { controller, update } = setup(current);

    await controller.updateSettings({ hotkey: "alt+ctrl+d" });

    expect(shortcut.register).not.toHaveBeenCalled();
    expect(shortcut.unregister).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ hotkey: "Control+Alt+D" });
  });

  it.each(["", "Ctrl+"])("rejects %j without touching registrations", async (hotkey) => {
    const { controller, update } = setup();

    await expect(controller.updateSettings({ hotkey })).rejects.toThrow();

    expect(shortcut.register).not.toHaveBeenCalled();
    expect(shortcut.unregister).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("registers and persists a new Practice activation shortcut", async () => {
    const { controller, update } = setup();

    await controller.updateSettings({ practiceHotkey: "Ctrl+Shift+P" });

    expect(shortcut.register).toHaveBeenCalledWith("Control+Shift+P", expect.any(Function));
    expect(update).toHaveBeenCalledWith({ practiceHotkey: "Control+Shift+P" });
    expect(shortcut.unregister).toHaveBeenCalledWith("Shift+F8");
  });

  it("probes a cancellation shortcut without holding it while Dictation is idle", async () => {
    const { controller, update } = setup();

    await controller.updateSettings({ cancelHotkey: "Ctrl+Escape" });

    expect(shortcut.register).toHaveBeenCalledWith("Control+Escape", expect.any(Function));
    expect(update).toHaveBeenCalledWith({ cancelHotkey: "Control+Escape" });
    expect(shortcut.unregister).toHaveBeenCalledTimes(1);
    expect(shortcut.unregister).toHaveBeenCalledWith("Control+Escape");
  });

  it("rejects shortcuts already assigned to another My Whispr action", async () => {
    const { controller, update } = setup();

    await expect(controller.updateSettings({ practiceHotkey: "f8" })).rejects.toThrow(
      "already assigned to Start/Stop dictation keys",
    );

    expect(shortcut.register).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("does not involve shortcut registration in unrelated settings updates", async () => {
    const { controller, update } = setup();

    await controller.updateSettings({ pasteShortcutMode: "terminal" });

    expect(update).toHaveBeenCalledWith({ pasteShortcutMode: "terminal" });
    expect(shortcut.register).not.toHaveBeenCalled();
    expect(shortcut.unregister).not.toHaveBeenCalled();
  });

  it("holds the cancellation shortcut only while a Dictation is active", async () => {
    const { controller } = setup();
    await controller.initialize();
    vi.clearAllMocks();
    shortcut.register.mockReturnValue(true);

    await controller.action("start");

    expect(shortcut.register).toHaveBeenCalledWith("Escape", expect.any(Function));
    expect(shortcut.unregister).not.toHaveBeenCalledWith("Escape");

    await controller.action("cancel");
    expect(shortcut.unregister).toHaveBeenCalledWith("Escape");
  });

  it("atomically replaces an active cancellation shortcut", async () => {
    const { controller, update } = setup();
    await controller.initialize();
    await controller.action("start");
    vi.clearAllMocks();
    shortcut.register.mockReturnValue(true);

    await controller.updateSettings({ cancelHotkey: "Ctrl+Escape" });

    expect(shortcut.register).toHaveBeenCalledWith("Control+Escape", expect.any(Function));
    expect(update).toHaveBeenCalledWith({ cancelHotkey: "Control+Escape" });
    expect(shortcut.unregister).toHaveBeenCalledWith("Escape");
    expect(shortcut.unregister).not.toHaveBeenCalledWith("Control+Escape");
  });

  it("keeps a newly saved cancellation shortcut active after a runtime grab failure", async () => {
    const { controller } = setup();
    await controller.initialize();
    shortcut.register.mockReturnValue(false);
    await controller.action("start");
    vi.clearAllMocks();
    shortcut.register.mockReturnValue(true);

    await controller.updateSettings({ cancelHotkey: "Ctrl+Escape" });

    expect(shortcut.register).toHaveBeenCalledWith("Control+Escape", expect.any(Function));
    expect(shortcut.unregister).not.toHaveBeenCalledWith("Control+Escape");
  });
});

describe("startup hotkey conflicts", () => {
  it("keeps the conflict error active, opens Settings, and does not fall back", async () => {
    const states: AppState[] = [];
    const { controller, settingsWindow } = setup(undefined, (state) => states.push(state));
    shortcut.register.mockImplementation((accelerator) => accelerator !== "F8");

    await controller.initialize();

    expect(shortcut.register.mock.calls.map(([accelerator]) => accelerator)).toEqual(["F8", "Shift+F8", "Escape"]);
    expect(states.at(-1)).toMatchObject({ phase: "error", message: "Dictation failed · see Settings" });
    expect((await controller.snapshot()).notice).toMatchObject({
      severity: "error",
      message: "Start/Stop dictation keys shortcut F8 is already in use or unavailable",
    });
    expect(settingsWindow.show).toHaveBeenCalled();
    expect(settingsWindow.focus).toHaveBeenCalled();
  });
});
