import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  LocalModel,
  PasteShortcutMode,
  RefinementProvider,
  RefinementMode,
  Settings,
  TranscriptionMode,
} from "../shared/types";

export const DEFAULT_SETTINGS: Settings = {
  version: 5,
  hotkey: "F8",
  practiceHotkey: "Shift+F8",
  cancelHotkey: "ESC",
  pasteShortcutMode: "automatic",
  transcriptionMode: "local",
  localModel: "base.en",
  refinementMode: "off",
  refinementProvider: "cerebras",
};

const isMode = (value: unknown): value is TranscriptionMode =>
  value === "local" || value === "cloud" || value === "azure";
const isModel = (value: unknown): value is LocalModel => value === "base.en" || value === "small.en";
const isRefinementProvider = (value: unknown): value is RefinementProvider =>
  value === "openai" || value === "cerebras";
const isPasteShortcutMode = (value: unknown): value is PasteShortcutMode =>
  value === "automatic" || value === "standard" || value === "terminal";
const isRefinementMode = (value: unknown): value is RefinementMode =>
  value === "off" || value === "light" || value === "medium";

export function sanitizeSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const input = value as Omit<Partial<Settings>, "refinementProvider"> & {
    refinementProvider?: unknown;
    refinementEnabled?: unknown;
  };
  return {
    version: 5,
    hotkey: typeof input.hotkey === "string" && input.hotkey.trim() ? input.hotkey.trim() : "F8",
    practiceHotkey: typeof input.practiceHotkey === "string" && input.practiceHotkey.trim()
      ? input.practiceHotkey.trim()
      : "Shift+F8",
    cancelHotkey: typeof input.cancelHotkey === "string" && input.cancelHotkey.trim()
      ? input.cancelHotkey.trim()
      : "ESC",
    pasteShortcutMode: isPasteShortcutMode(input.pasteShortcutMode) ? input.pasteShortcutMode : "automatic",
    transcriptionMode: isMode(input.transcriptionMode) ? input.transcriptionMode : "local",
    localModel: isModel(input.localModel) ? input.localModel : "base.en",
    // A removed provider must not silently switch an active refinement to another service.
    refinementMode: input.refinementProvider === "azure"
      ? "off"
      : isRefinementMode(input.refinementMode)
        ? input.refinementMode
        : input.refinementEnabled === true
          ? "light"
          : "off",
    refinementProvider: isRefinementProvider(input.refinementProvider) ? input.refinementProvider : "cerebras",
  };
}

export class SettingsStore {
  private value: Settings = { ...DEFAULT_SETTINGS };

  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    try {
      this.value = sanitizeSettings(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    return this.get();
  }

  get(): Settings {
    return { ...this.value };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    this.value = sanitizeSettings({ ...this.value, ...patch });
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
    return this.get();
  }
}
