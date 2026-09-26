import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvironment } from "dotenv";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
} from "electron";
import lightPromptDefault from "../../light_refine_prompt.md?raw";
import mediumPromptDefault from "../../medium_refine_prompt.md?raw";
import practiceGrammarDefault from "../../practice_grammar_prompt.md?raw";
import practicePronunciationDefault from "../../practice_pronunciation_prompt.md?raw";
import type { AppAction, AppState, LocalModel, PracticePromptKind, PracticeState, RefinementLevel, Settings } from "../shared/types";
import { DictationController } from "./controller";
import { DeliveryService } from "./delivery";
import { parseCorrectedTranscript } from "./core/practice-actions";
import { ModelManager } from "./model-manager";
import { PracticeSession } from "./practice-session";
import { PracticePromptStore } from "./practice-prompt-store";
import { RefinementPromptStore } from "./refinement-prompt-store";
import { SettingsStore } from "./settings-store";
import { TempFiles } from "./temp-files";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
loadEnvironment({ path: join(process.cwd(), ".env"), quiet: true });

let overlayWindow: BrowserWindow;
let settingsWindow: BrowserWindow;
let tray: Tray;
let idleTrayIcon: Electron.NativeImage;
let recordingTrayIcon: Electron.NativeImage;
let controller: DictationController;
let refinementPrompts: RefinementPromptStore;
let practicePrompts: PracticePromptStore;
let currentAppState: AppState | undefined;
let quitting = false;

app.setName("My Whispr");

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  overlayWindow = createWindow("overlay");
  settingsWindow = createWindow("settings");
  tray = createTray();

  const whisperBinary =
    process.env.WHISPER_CPP_SERVER_PATH ||
    join(process.cwd(), "vendor", "whisper.cpp", "build", "bin", "whisper-server");
  const userData = app.getPath("userData");
  const temporaryRoot = join(app.getPath("temp"), "my-whispr-dictation");
  refinementPrompts = new RefinementPromptStore(process.cwd(), {
    light: lightPromptDefault,
    medium: mediumPromptDefault,
  });
  const practice = new PracticeSession((state) => updatePractice(state));
  practicePrompts = new PracticePromptStore(process.cwd(), {
    grammar: practiceGrammarDefault,
    pronunciation: practicePronunciationDefault,
  });
  controller = new DictationController(
    { overlay: overlayWindow, settings: settingsWindow },
    new SettingsStore(join(userData, "settings.json")),
    new ModelManager(join(userData, "models")),
    new TempFiles(temporaryRoot),
    new DeliveryService(),
    refinementPrompts,
    practice,
    practicePrompts,
    whisperBinary,
    updateStatus,
  );
  registerIpc();
  await Promise.all([
    onceLoaded(overlayWindow),
    onceLoaded(settingsWindow),
  ]);
  await controller.initialize();
  rebuildTray();
  if (process.argv.includes("--show-settings")) {
    settingsWindow.show();
    settingsWindow.focus();
  }
});

app.on("window-all-closed", () => {
  // The tray owns the application lifecycle.
});
app.on("before-quit", (event) => {
  if (quitting || !controller) return;
  event.preventDefault();
  quitting = true;
  void controller.shutdown().finally(() => app.quit());
});

function createWindow(kind: "overlay" | "settings"): BrowserWindow {
  const isOverlay = kind === "overlay";
  const window = new BrowserWindow({
    width: isOverlay ? 380 : 1040,
    height: isOverlay ? 116 : 720,
    show: false,
    frame: !isOverlay,
    transparent: isOverlay,
    resizable: !isOverlay,
    alwaysOnTop: isOverlay,
    focusable: !isOverlay,
    skipTaskbar: isOverlay,
    title: isOverlay ? "My Whispr" : "My Whispr Settings",
    backgroundColor: isOverlay ? "#00000000" : "#101114",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Microphone capture runs in the overlay renderer even while it is hidden.
      backgroundThrottling: !isOverlay,
    },
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[my-whispr] preload failed (${preloadPath}):`, error);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[my-whispr] renderer exited (${kind}):`, details.reason);
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`[my-whispr] renderer failed to load (${kind}): ${code} ${description}`);
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  if (isOverlay) {
    window.setIgnoreMouseEvents(true);
    const { workArea } = screen.getPrimaryDisplay();
    window.setPosition(Math.round(workArea.x + (workArea.width - 380) / 2), workArea.y + 32);
  }
  void loadRenderer(window, kind);
  return window;
}

async function loadRenderer(window: BrowserWindow, kind: string): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?window=${kind}`);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"), { query: { window: kind } });
  }
}

function onceLoaded(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoading()) return Promise.resolve();
  return new Promise((resolve) => window.webContents.once("did-finish-load", () => resolve()));
}

function createTray(): Tray {
  const iconPath = join(process.cwd(), "resources", "tray.png");
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  idleTrayIcon = icon.resize({ width: 18, height: 18 });
  // Tint the existing microphone red, preserving its antialiased alpha mask.
  const bitmap = idleTrayIcon.toBitmap();
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    const alpha = bitmap[offset + 3] / 255;
    bitmap[offset] = Math.round(68 * alpha);
    bitmap[offset + 1] = Math.round(68 * alpha);
    bitmap[offset + 2] = Math.round(255 * alpha);
  }
  recordingTrayIcon = nativeImage.createFromBitmap(bitmap, idleTrayIcon.getSize());
  const instance = new Tray(idleTrayIcon);
  instance.setToolTip("My Whispr");
  instance.on("click", () => {
    settingsWindow.show();
    settingsWindow.focus();
  });
  return instance;
}

function rebuildTray(state?: AppState): void {
  const primaryAction =
    state?.phase === "recording"
      ? { label: "Stop Dictation", click: () => void controller.action("stop") }
      : state && !["idle", "recoverable", "error"].includes(state.phase)
        ? { label: state.message, enabled: false }
        : { label: "Start Dictation", click: () => void controller.action("start") };
  const recoveryActions = state?.canCopyAgain
    ? [{ label: "Copy again", click: () => void controller.action("copy-again") }]
    : [];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      primaryAction,
      ...recoveryActions,
      { type: "separator" },
      {
        label: "Settings",
        click: () => {
          settingsWindow.show();
          settingsWindow.focus();
        },
      },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

function updatePractice(state: PracticeState): void {
  if (!settingsWindow?.isDestroyed()) settingsWindow.webContents.send("practice:changed", state);
}

function updateStatus(state: AppState): void {
  currentAppState = state;
  const recording = state.phase === "recording" || state.phase === "stopping";
  tray.setImage(recording ? recordingTrayIcon : idleTrayIcon);
  const countdown = state.countdownSeconds === undefined ? "" : ` · ${state.countdownSeconds}s remaining`;
  tray.setToolTip(`My Whispr · ${state.message}${countdown}`);
  rebuildTray(state);
  overlayWindow.hide();
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => controller.snapshot());
  ipcMain.handle("settings:update", (_event, patch: Partial<Settings>) => controller.updateSettings(patch));
  ipcMain.handle("model:download", (_event, model: LocalModel) => controller.downloadModel(model));
  ipcMain.handle("model:remove", (_event, model: LocalModel) => controller.removeModel(model));
  ipcMain.handle("refinement:prompt-open", async (_event, value: unknown) => {
    const level = refinementLevel(value);
    const error = await shell.openPath(await refinementPrompts.ensureFile(level));
    if (error) throw new Error(error);
  });
  ipcMain.handle("refinement:prompt-reset", (_event, value: unknown) =>
    refinementPrompts.reset(refinementLevel(value)),
  );
  ipcMain.handle("practice:get", () => controller.practiceSnapshot());
  ipcMain.handle("practice:update-correction", (_event, correctedTranscript: unknown) =>
    controller.updatePracticeCorrection(parseCorrectedTranscript(correctedTranscript)),
  );
  ipcMain.handle("practice:analyze", (_event, correctedTranscript: unknown) =>
    controller.analyzePractice(parseCorrectedTranscript(correctedTranscript)),
  );
  ipcMain.handle("practice:discard", () => controller.discardPractice());
  ipcMain.handle("practice:synthesize", () => controller.synthesizePracticeExample());
  ipcMain.handle("practice:synthesize-word", (_event, word: unknown) => {
    if (typeof word !== "string" || !word.trim()) throw new Error("Invalid Practice word");
    return controller.synthesizePracticeWord(word);
  });
  ipcMain.handle("practice:audio", (_event, kind: "recording" | "example") => {
    if (kind !== "recording" && kind !== "example") throw new Error("Invalid Practice audio kind");
    return controller.practiceAudio(kind);
  });
  ipcMain.handle("practice:prompt-open", async (_event, value: unknown) => {
    const kind = practicePromptKind(value);
    const error = await shell.openPath(await practicePrompts.ensureFile(kind));
    if (error) throw new Error(error);
  });
  ipcMain.handle("practice:prompt-reset", (_event, value: unknown) => practicePrompts.reset(practicePromptKind(value)));
  ipcMain.handle("app:action", (_event, action: AppAction) => controller.action(action));
  ipcMain.handle("capture:complete", (_event, wav: Uint8Array) => controller.completeCapture(wav));
  ipcMain.handle("capture:error", (_event, message: string) => controller.failCapture(message));
  ipcMain.on("debug:capture-timing", (_event, stage: string, elapsedMs: number) => {
    console.info(`[DEBUG-capture-latency] renderer ${stage}: ${elapsedMs.toFixed(1)} ms`);
  });
}

function refinementLevel(value: unknown): RefinementLevel {
  if (value === "light" || value === "medium") return value;
  throw new Error("Invalid Refinement Level");
}

function practicePromptKind(value: unknown): PracticePromptKind {
  if (value === "grammar" || value === "pronunciation") return value;
  throw new Error("Invalid Practice prompt kind");
}
