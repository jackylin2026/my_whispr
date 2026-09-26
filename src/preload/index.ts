import { contextBridge, ipcRenderer } from "electron";
import type {
  AppAction,
  AppState,
  LocalModel,
  MyWhisprApi,
  RefinementLevel,
  Settings,
  SettingsSnapshot,
  PracticeState,
  PracticePromptKind,
} from "../shared/types";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: MyWhisprApi = {
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<SettingsSnapshot>,
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke("settings:update", patch) as Promise<SettingsSnapshot>,
  downloadModel: (model: LocalModel) => ipcRenderer.invoke("model:download", model) as Promise<void>,
  removeModel: (model: LocalModel) => ipcRenderer.invoke("model:remove", model) as Promise<void>,
  openRefinementPrompt: (level: RefinementLevel) =>
    ipcRenderer.invoke("refinement:prompt-open", level) as Promise<void>,
  resetRefinementPrompt: (level: RefinementLevel) =>
    ipcRenderer.invoke("refinement:prompt-reset", level) as Promise<void>,
  getPractice: () => ipcRenderer.invoke("practice:get") as Promise<PracticeState>,
  updatePracticeCorrection: (correctedTranscript: string) =>
    ipcRenderer.invoke("practice:update-correction", correctedTranscript) as Promise<PracticeState>,
  analyzePractice: (correctedTranscript: string) => ipcRenderer.invoke("practice:analyze", correctedTranscript) as Promise<PracticeState>,
  discardPractice: () => ipcRenderer.invoke("practice:discard") as Promise<PracticeState>,
  synthesizePracticeExample: () => ipcRenderer.invoke("practice:synthesize") as Promise<PracticeState>,
  synthesizePracticeWord: (word: string) => ipcRenderer.invoke("practice:synthesize-word", word) as Promise<Uint8Array>,
  getPracticeAudio: (kind: "recording" | "example") => ipcRenderer.invoke("practice:audio", kind) as Promise<Uint8Array | null>,
  openPracticePrompt: (kind: PracticePromptKind) => ipcRenderer.invoke("practice:prompt-open", kind) as Promise<void>,
  resetPracticePrompt: (kind: PracticePromptKind) => ipcRenderer.invoke("practice:prompt-reset", kind) as Promise<void>,
  action: (action: AppAction) => ipcRenderer.invoke("app:action", action) as Promise<void>,
  completeCapture: (wav: Uint8Array) => ipcRenderer.invoke("capture:complete", wav) as Promise<void>,
  failCapture: (message: string) => ipcRenderer.invoke("capture:error", message) as Promise<void>,
  reportCaptureTiming: (stage: string, elapsedMs: number) => ipcRenderer.send("debug:capture-timing", stage, elapsedMs),
  onState: (listener: (state: AppState) => void) => subscribe("state:update", listener),
  onCaptureStart: (listener: () => void) => subscribe("capture:start", listener),
  onCaptureStop: (listener: () => void) => subscribe("capture:stop", listener),
  onCaptureCancel: (listener: () => void) => subscribe("capture:cancel", listener),
  onSettingsChanged: (listener: (snapshot: SettingsSnapshot) => void) => subscribe("settings:changed", listener),
  onPracticeChanged: (listener: (state: PracticeState) => void) => subscribe("practice:changed", listener),
  onPracticeRequested: (listener: () => void) => subscribe("practice:open", listener),
};

contextBridge.exposeInMainWorld("myWhispr", api);
