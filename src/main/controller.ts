import { access, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, globalShortcut, type BrowserWindow } from "electron";
import type { AppAction, AppNotice, AppState, LocalModel, PracticeState, RefinementProvider, Settings, SettingsSnapshot } from "../shared/types";
import { AzureSpeechClient } from "./azure-speech-client";
import { CerebrasClient } from "./cerebras-client";
import {
  assessRefinement,
  normalizeTranscript,
  type RefinementRejectionReason,
  type RefinementRequest,
} from "./core/refinement";
import {
  hotkeysEquivalent,
  HOTKEY_LABELS,
  type HotkeySetting,
  InvalidHotkeyError,
  normalizeConfiguredHotkeys,
  normalizeHotkey,
} from "./core/hotkey";
import { idleState, transition } from "./core/state-machine";
import { DeliveryService, type DeliveryTarget } from "./delivery";
import { ModelManager } from "./model-manager";
import { OpenAiClient } from "./openai-client";
import { PracticeCoach } from "./practice-coach";
import { PracticeSession } from "./practice-session";
import { PracticePromptStore } from "./practice-prompt-store";
import { RefinementPromptStore } from "./refinement-prompt-store";
import { SettingsStore } from "./settings-store";
import { TempFiles } from "./temp-files";
import { WhisperServer } from "./whisper-server";

interface PendingAudio {
  path: string;
  dispose(): Promise<void>;
}

interface ControllerWindows {
  overlay: BrowserWindow;
  settings: BrowserWindow;
}

const MAX_RECORDING_SECONDS = 300;
const RECOVERY_MS = 5_000;
const HOTKEY_SETTINGS: HotkeySetting[] = ["hotkey", "practiceHotkey", "cancelHotkey"];

export class DictationController {
  private state: AppState = idleState();
  private deliveryTarget: DeliveryTarget | null = null;
  private pendingAudio?: PendingAudio;
  private recoverableText?: string;
  private abort?: AbortController;
  private recordStartedAt = 0;
  private recordTimer?: NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;
  private retryMode: "record" | "process" = "record";
  private whisper?: WhisperServer;
  private activeWhisperModel?: LocalModel;
  private readonly registeredHotkeys: Partial<Record<HotkeySetting, string>> = {};
  private hotkeyConfigurationError = false;
  private starting = false;
  private lastHotkeyAt = 0;
  private notice?: AppNotice;
  private nextNoticeId = 1;
  private hotkeyStartedAt = 0;

  constructor(
    private readonly windows: ControllerWindows,
    private readonly settingsStore: SettingsStore,
    private readonly models: ModelManager,
    private readonly tempFiles: TempFiles,
    private readonly delivery: DeliveryService,
    private readonly refinementPrompts: RefinementPromptStore,
    private readonly practice: PracticeSession,
    private readonly practicePrompts: PracticePromptStore,
    private readonly whisperBinary: string,
    private readonly onStateChanged?: (state: AppState) => void,
  ) {}

  async initialize(): Promise<void> {
    await this.settingsStore.load();
    await this.tempFiles.purge();
    let hotkeys: Record<HotkeySetting, string>;
    try {
      const settings = this.settingsStore.get();
      hotkeys = normalizeConfiguredHotkeys(settings);
    } catch (error) {
      this.publishHotkeyConfigurationError(error instanceof Error ? error.message : "Invalid hotkey configuration");
      void this.preloadSelectedModel();
      return;
    }

    const failures: string[] = [];
    for (const setting of ["hotkey", "practiceHotkey"] satisfies HotkeySetting[]) {
      const error = this.registerPersistentHotkey(setting, hotkeys[setting]);
      if (error) failures.push(error);
    }
    const cancelError = this.probeHotkey("cancelHotkey", hotkeys.cancelHotkey);
    if (cancelError) failures.push(cancelError);
    if (failures.length) {
      this.publishHotkeyConfigurationError(failures.join(" "));
    } else {
      this.publishState(idleState());
    }
    void this.preloadSelectedModel();
  }

  async snapshot(): Promise<SettingsSnapshot> {
    return {
      settings: this.settingsStore.get(),
      models: await this.models.states(),
      environment: {
        hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
        hasCerebrasKey: Boolean(process.env.CEREBRAS_API_KEY?.trim()),
        hasXdotool: await exists("/usr/bin/xdotool"),
        whisperServerAvailable: await exists(this.whisperBinary),
        hasAzureSpeech: Boolean(process.env.AZURE_SPEECH_KEY?.trim() && process.env.AZURE_SPEECH_REGION?.trim()),
      },
      notice: this.notice,
    };
  }

  practiceSnapshot(): PracticeState { return this.practice.snapshot(); }

  async capturePracticeSelection(): Promise<PracticeState> {
    const state = await this.practice.updateCorrection(await this.delivery.selectedText());
    this.openSettings("practice");
    return state;
  }

  async updatePracticeCorrection(correctedTranscript: string): Promise<PracticeState> {
    return this.practice.updateCorrection(correctedTranscript);
  }

  async analyzePractice(correctedTranscript: string): Promise<PracticeState> {
    await this.practice.updateCorrection(correctedTranscript);
    const azure = this.optionalAzureSpeech() ?? {
      assess: async () => { throw new Error("Azure Speech is not configured. Run npm run setup:azure-speech."); },
    };
    const settings = this.settingsStore.get();
    const completeText = (request: RefinementRequest, signal?: AbortSignal) =>
      this.completeText(settings.refinementProvider, request, signal);
    const coach = new PracticeCoach(this.practicePrompts, azure, completeText);
    return this.practice.analyze(
      (input, signal) => coach.analyze(input.audioPath, input.rawTranscript, input.correctedTranscript, signal),
    );
  }

  async discardPractice(): Promise<PracticeState> { return this.practice.discard(); }

  async synthesizePracticeExample(): Promise<PracticeState> {
    const text = this.practice.exampleText();
    if (!text) throw new Error("Analyze the Practice Session first");
    const recordingPath = this.practice.recordingPath();
    if (!recordingPath) throw new Error("Practice recording is unavailable");
    const path = join(dirname(recordingPath), `american-example-${Date.now()}.wav`);
    await this.azureSpeech().synthesize(text, path);
    return this.practice.setExampleAudio({ path, dispose: () => unlink(path).catch(() => undefined) });
  }

  async practiceAudio(kind: "recording" | "example"): Promise<Uint8Array | null> {
    const path = kind === "recording" ? this.practice.recordingPath() : this.practice.examplePath();
    return path ? new Uint8Array(await readFile(path)) : null;
  }

  async synthesizePracticeWord(word: string): Promise<Uint8Array> {
    if (!this.practice.hasPronunciationWord(word)) throw new Error("Unknown Practice pronunciation word");
    const recordingPath = this.practice.recordingPath();
    if (!recordingPath) throw new Error("Practice recording is unavailable");
    const path = join(dirname(recordingPath), `golden-word-${Date.now()}.wav`);
    try {
      await this.azureSpeech().synthesize(word, path);
      return new Uint8Array(await readFile(path));
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }

  async updateSettings(patch: Partial<Settings>): Promise<SettingsSnapshot> {
    const current = this.settingsStore.get();
    let updated: Settings;
    if (HOTKEY_SETTINGS.some((setting) => Object.hasOwn(patch, setting))) {
      updated = await this.updateHotkeySettings(current, patch);
    } else {
      updated = await this.settingsStore.update(patch);
    }
    if (
      updated.localModel !== this.activeWhisperModel ||
      updated.transcriptionMode !== current.transcriptionMode
    ) {
      await this.whisper?.stop();
      this.whisper = undefined;
      this.activeWhisperModel = undefined;
      if (updated.transcriptionMode === "local") void this.preloadSelectedModel();
    }
    const snapshot = await this.snapshot();
    this.broadcast("settings:changed", snapshot);
    return snapshot;
  }

  async downloadModel(model: LocalModel): Promise<void> {
    await this.models.download(model, (progress) => {
      void this.broadcastSnapshot(progress, model);
    });
    await this.broadcastSnapshot();
    if (this.settingsStore.get().localModel === model) void this.preloadSelectedModel();
  }

  async removeModel(model: LocalModel): Promise<void> {
    if (this.activeWhisperModel === model) {
      await this.whisper?.stop();
      this.whisper = undefined;
      this.activeWhisperModel = undefined;
    }
    await this.models.remove(model);
    await this.broadcastSnapshot();
  }

  async action(action: AppAction): Promise<void> {
    switch (action) {
      case "start":
        await this.start();
        break;
      case "stop":
        this.stopRecording();
        break;
      case "cancel":
      case "discard":
        this.dismissNotice();
        await this.cancel();
        break;
      case "retry":
        this.dismissNotice();
        if (this.retryMode === "process" && this.pendingAudio) await this.processPendingAudio();
        else await this.start();
        break;
      case "copy-again":
        if (this.recoverableText) await this.delivery.copy(this.recoverableText);
        break;
      case "dismiss-notice":
        this.dismissNotice();
        break;
    }
  }

  async completeCapture(wav: Uint8Array): Promise<void> {
    if (this.state.phase !== "recording" && this.state.phase !== "stopping") return;
    this.clearRecordTimer();
    this.publishState(transition(this.state, { type: "CAPTURED" }));
    await this.disposePendingAudio();
    this.pendingAudio = await this.tempFiles.createWav(wav);
    this.retryMode = "process";
    await this.processPendingAudio();
  }

  async failCapture(message: string): Promise<void> {
    this.clearRecordTimer();
    this.retryMode = "record";
    await this.disposePendingAudio();
    if (/no speech/i.test(message)) this.publishState(transition(this.state, { type: "NO_SPEECH" }));
    else this.publishState(transition(this.state, { type: "FAIL", message, retryable: true }));
  }

  async shutdown(): Promise<void> {
    this.abort?.abort();
    this.clearRecordTimer();
    clearTimeout(this.recoveryTimer);
    await this.disposePendingAudio();
    await this.practice.discard(false);
    await this.whisper?.stop();
    await this.tempFiles.purge();
    globalShortcut.unregisterAll();
  }

  private async toggle(): Promise<void> {
    if (this.state.phase === "idle" || this.state.phase === "recoverable" || this.state.phase === "error") {
      await this.start();
    } else if (this.state.phase === "recording") {
      this.stopRecording();
    }
  }

  private async start(): Promise<void> {
    if (this.starting || !["idle", "recoverable", "error"].includes(this.state.phase)) return;
    if (this.practice.snapshot().phase === "analyzing") {
      throw new Error("Wait for Practice analysis to finish or discard the session first");
    }
    this.starting = true;
    try {
      await this.resetEphemeral();
      console.info(`[DEBUG-capture-latency] main cleanup: ${(performance.now() - this.hotkeyStartedAt).toFixed(1)} ms`);
      this.deliveryTarget = await this.delivery.activeTarget();
      console.info(`[DEBUG-capture-latency] main target lookup: ${(performance.now() - this.hotkeyStartedAt).toFixed(1)} ms`);
      const recording = transition(this.state, { type: "START" });
      const settings = this.settingsStore.get();
      this.publishState({
        ...recording,
        message: `Recording · ${settings.hotkey} to finish · ${settings.cancelHotkey} to discard`,
      });
      this.windows.overlay.webContents.send("capture:start");
      console.info(`[DEBUG-capture-latency] main IPC sent: ${(performance.now() - this.hotkeyStartedAt).toFixed(1)} ms`);
      this.registerCancelHotkey();
      this.recordStartedAt = Date.now();
      this.recordTimer = setInterval(() => this.tickRecording(), 1_000);
    } catch (error) {
      this.publishState({
        phase: "error",
        message: error instanceof Error ? error.message : "Unable to start Dictation",
        canRetry: true,
        canDiscard: true,
      });
    } finally {
      this.starting = false;
    }
  }

  private stopRecording(): void {
    if (this.state.phase !== "recording") return;
    this.publishState(transition(this.state, { type: "STOP" }));
    this.windows.overlay.webContents.send("capture:stop");
  }

  private async cancel(): Promise<void> {
    this.abort?.abort();
    this.windows.overlay.webContents.send("capture:cancel");
    await this.resetEphemeral();
    this.publishState(idleState());
  }

  private async processPendingAudio(): Promise<void> {
    if (!this.pendingAudio) return;
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const settings = this.settingsStore.get();

    try {
      if (this.state.phase === "error") this.publishState({ phase: "transcribing", message: "Retrying transcription…" });
      let raw: string;
      if (settings.transcriptionMode === "local") {
        const modelPath = await this.ensureModel(settings.localModel);
        const whisper = await this.ensureWhisper(settings.localModel);
        raw = await whisper.transcribe(this.pendingAudio.path, modelPath, signal);
      } else if (settings.transcriptionMode === "azure") {
        raw = await this.azureSpeech().transcribe(this.pendingAudio.path, signal);
      } else {
        raw = await this.openAi().transcribe(this.pendingAudio.path, signal);
      }
      raw = normalizeTranscript(raw);
      if (!raw) throw new Error("No speech detected");

      const shouldRefine = settings.refinementMode !== "off";
      this.publishState(transition(this.state, { type: "TRANSCRIBED", refine: shouldRefine }));
      let selected = raw;
      if (settings.refinementMode !== "off") {
        try {
          const refinementSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
          const loadedPrompt = await this.refinementPrompts.build(settings.refinementMode, raw);
          if (loadedPrompt.warning) this.publishNotice("warning", loadedPrompt.warning);
          const candidate = await this.completeText(settings.refinementProvider, loadedPrompt.request, refinementSignal);
          const assessment = assessRefinement(raw, candidate);
          selected = assessment.accepted ? assessment.text : raw;
          if (!assessment.accepted) {
            this.publishNotice(
              "warning",
              refinementRejectionMessage(assessment.reason),
            );
          }
          this.publishState(transition(this.state, { type: "REFINED" }));
        } catch (error) {
          if (signal.aborted) throw error;
          const reason = error instanceof Error ? error.message : "Unknown refinement error";
          this.publishNotice("warning", `Refinement failed (${reason}), so the Raw Transcript was pasted instead.`);
          this.publishState({ phase: "delivering", message: "Pasting raw transcript…" });
        }
      }

      const pasted = await this.delivery.deliver(
        this.deliveryTarget,
        selected,
        settings.pasteShortcutMode,
      );
      if (!pasted) {
        this.publishNotice(
          "warning",
          "The original target window was unavailable, so text was not pasted. Use Copy again from the tray menu.",
        );
      }
      this.recoverableText = selected;
      if (this.pendingAudio) {
        const audio = this.pendingAudio;
        this.pendingAudio = undefined;
        await this.practice.replace(audio, raw);
      }
      const delivered = transition(this.state, { type: "DELIVERED" });
      this.publishState({
        ...delivered,
        message: pasted ? "Pasted" : "Target unavailable",
      });
      this.retryMode = "record";
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = setTimeout(() => void this.finishRecovery(), RECOVERY_MS);
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : "Dictation failed";
      if (/no speech/i.test(message)) {
        this.retryMode = "record";
        await this.disposePendingAudio();
        this.publishState({ phase: "error", message: "No speech detected", canRetry: true, canDiscard: true });
      } else {
        this.retryMode = "process";
        this.publishState({ phase: "error", message, canRetry: true, canDiscard: true });
      }
    }
  }

  private async ensureModel(model: LocalModel): Promise<string> {
    if (!(await this.models.isInstalled(model))) {
      this.publishState({ phase: "transcribing", message: `Downloading ${model}…` });
      let lastPercentage = -1;
      return this.models.download(model, (progress) => {
        const percentage = Math.round(progress * 100);
        if (percentage === lastPercentage) return;
        lastPercentage = percentage;
        this.publishState({ phase: "transcribing", message: `Downloading ${model} · ${percentage}%` });
      });
    }
    return this.models.pathFor(model);
  }

  private async ensureWhisper(model: LocalModel): Promise<WhisperServer> {
    if (!(await exists(this.whisperBinary))) {
      throw new Error("Local engine is not built. Run npm run setup:whisper first.");
    }
    if (!this.whisper || this.activeWhisperModel !== model) {
      await this.whisper?.stop();
      this.whisper = new WhisperServer(this.whisperBinary);
      this.activeWhisperModel = model;
    }
    return this.whisper;
  }

  private openAi(): OpenAiClient {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error("OPENAI_API_KEY is missing from .env");
    return new OpenAiClient(key);
  }

  private cerebras(): CerebrasClient {
    const key = process.env.CEREBRAS_API_KEY?.trim();
    if (!key) throw new Error("CEREBRAS_API_KEY is missing from .env");
    return new CerebrasClient(key);
  }

  private async completeText(provider: RefinementProvider, request: RefinementRequest, signal?: AbortSignal): Promise<string> {
    switch (provider) {
      case "openai": return this.openAi().refine(request, signal);
      case "cerebras": return this.cerebras().refine(request, signal);
    }
  }

  private azureSpeech(): AzureSpeechClient {
    const key = process.env.AZURE_SPEECH_KEY?.trim();
    const region = process.env.AZURE_SPEECH_REGION?.trim();
    if (!key || !region) throw new Error("Azure Speech is not configured. Run npm run setup:azure-speech.");
    return new AzureSpeechClient(key, region);
  }

  private optionalAzureSpeech(): AzureSpeechClient | undefined {
    const key = process.env.AZURE_SPEECH_KEY?.trim();
    const region = process.env.AZURE_SPEECH_REGION?.trim();
    return key && region ? new AzureSpeechClient(key, region) : undefined;
  }

  private async preloadSelectedModel(): Promise<void> {
    const settings = this.settingsStore.get();
    if (settings.transcriptionMode !== "local" || !(await this.models.isInstalled(settings.localModel))) return;
    try {
      const whisper = await this.ensureWhisper(settings.localModel);
      await whisper.load(this.models.pathFor(settings.localModel));
    } catch {
      // Surface engine errors only when local transcription is requested.
    }
  }

  private tickRecording(): void {
    if (this.state.phase !== "recording") return;
    const elapsed = Math.floor((Date.now() - this.recordStartedAt) / 1_000);
    const remaining = MAX_RECORDING_SECONDS - elapsed;
    if (remaining <= 0) {
      this.stopRecording();
      return;
    }
    if (remaining <= 30) this.publishState({ ...this.state, countdownSeconds: remaining });
  }

  private async updateHotkeySettings(current: Settings, patch: Partial<Settings>): Promise<Settings> {
    const hotkeys = normalizeConfiguredHotkeys({ ...current, ...patch });
    const normalizedPatch: Partial<Settings> = { ...patch };
    if (Object.hasOwn(patch, "hotkey")) normalizedPatch.hotkey = hotkeys.hotkey;
    if (Object.hasOwn(patch, "practiceHotkey")) normalizedPatch.practiceHotkey = hotkeys.practiceHotkey;
    if (Object.hasOwn(patch, "cancelHotkey")) normalizedPatch.cancelHotkey = hotkeys.cancelHotkey;
    const grabbed: Array<{ setting: HotkeySetting; hotkey: string; temporary: boolean }> = [];
    try {
      for (const setting of HOTKEY_SETTINGS) {
        const requested = Object.hasOwn(patch, setting);
        if (!requested && !this.hotkeyConfigurationError) continue;
        const active = this.registeredHotkeys[setting];
        if (active && hotkeysEquivalent(active, hotkeys[setting])) continue;
        if (
          setting !== "cancelHotkey" && !active && !this.hotkeyConfigurationError &&
          hotkeysEquivalent(current[setting], hotkeys[setting])
        ) continue;
        const cancelNeededNow = !["idle", "recoverable", "error"].includes(this.state.phase);
        const temporary = setting === "cancelHotkey" && !active && !cancelNeededNow;
        this.registerShortcut(setting, hotkeys[setting], temporary ? () => undefined : this.hotkeyCallback(setting));
        grabbed.push({ setting, hotkey: hotkeys[setting], temporary });
      }
    } catch (error) {
      for (const item of grabbed.reverse()) globalShortcut.unregister(item.hotkey);
      throw error;
    }

    let updated: Settings;
    try {
      updated = await this.settingsStore.update(normalizedPatch);
    } catch (error) {
      for (const item of grabbed.reverse()) globalShortcut.unregister(item.hotkey);
      throw error;
    }

    for (const item of grabbed) {
      const previous = this.registeredHotkeys[item.setting] ?? (
        item.setting === "cancelHotkey" ? undefined : normalizeHotkey(current[item.setting])
      );
      if (previous) globalShortcut.unregister(previous);
      if (item.temporary) {
        globalShortcut.unregister(item.hotkey);
      } else {
        this.registeredHotkeys[item.setting] = item.hotkey;
      }
    }

    if (this.hotkeyConfigurationError) {
      this.hotkeyConfigurationError = false;
      this.notice = undefined;
      this.publishState(idleState());
    }
    return updated;
  }

  private registerPersistentHotkey(setting: "hotkey" | "practiceHotkey", hotkey: string): string | undefined {
    try {
      this.registerShortcut(setting, hotkey, this.hotkeyCallback(setting));
      this.registeredHotkeys[setting] = hotkey;
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : `${HOTKEY_LABELS[setting]} could not be registered`;
    }
  }

  private probeHotkey(setting: "cancelHotkey", hotkey: string): string | undefined {
    try {
      this.registerShortcut(setting, hotkey, () => undefined);
      globalShortcut.unregister(hotkey);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : `${HOTKEY_LABELS[setting]} could not be registered`;
    }
  }

  private registerShortcut(setting: HotkeySetting, hotkey: string, callback: () => void): void {
    let registered: boolean;
    try {
      registered = globalShortcut.register(hotkey, callback);
    } catch {
      throw new InvalidHotkeyError(`${HOTKEY_LABELS[setting]} shortcut ${hotkey} is invalid or unsupported`);
    }
    if (!registered) throw new Error(`${HOTKEY_LABELS[setting]} shortcut ${hotkey} is already in use or unavailable`);
  }

  private hotkeyCallback(setting: HotkeySetting): () => void {
    if (setting === "hotkey") return () => this.handleHotkey();
    if (setting === "cancelHotkey") return () => void this.cancel();
    return () => void this.capturePracticeSelection().catch((error: unknown) => {
      this.publishNotice("warning", error instanceof Error ? error.message : String(error));
      this.openSettings(this.practice.snapshot().hasRecording ? "practice" : undefined);
    });
  }

  private publishHotkeyConfigurationError(message: string): void {
    this.hotkeyConfigurationError = true;
    this.publishState({ phase: "error", message, canDiscard: true });
    this.windows.settings.show();
  }

  private handleHotkey(): void {
    const now = Date.now();
    if (now - this.lastHotkeyAt < 350) return;
    this.lastHotkeyAt = now;
    this.hotkeyStartedAt = performance.now();
    console.info("[DEBUG-capture-latency] hotkey accepted: 0.0 ms");
    void this.toggle().catch((error: unknown) => {
      this.publishState({
        phase: "error",
        message: error instanceof Error ? error.message : "Global shortcut failed",
        canRetry: true,
        canDiscard: true,
      });
    });
  }

  private registerCancelHotkey(): void {
    const hotkey = normalizeHotkey(this.settingsStore.get().cancelHotkey);
    try {
      this.registerShortcut("cancelHotkey", hotkey, this.hotkeyCallback("cancelHotkey"));
      this.registeredHotkeys.cancelHotkey = hotkey;
    } catch (error) {
      this.publishNotice("warning", error instanceof Error ? error.message : "Cancelation keys could not be registered");
    }
  }

  private unregisterCancelHotkey(): void {
    const hotkey = this.registeredHotkeys.cancelHotkey;
    if (!hotkey) return;
    globalShortcut.unregister(hotkey);
    delete this.registeredHotkeys.cancelHotkey;
  }

  private async finishRecovery(): Promise<void> {
    this.recoverableText = undefined;
    this.deliveryTarget = null;
    this.publishState(idleState());
  }

  private publishState(state: AppState): void {
    let displayedState = state;
    if (state.phase === "error") {
      this.publishNotice("error", state.message);
      displayedState = {
        ...state,
        message: state.message === "No speech detected" ? state.message : "Dictation failed · see Settings",
      };
      this.windows.settings.show();
      this.windows.settings.focus();
    }
    this.state = displayedState;
    console.info(`[my-whispr] ${displayedState.phase}: ${displayedState.message}`);
    if (["idle", "recoverable", "error"].includes(displayedState.phase)) {
      this.clearRecordTimer();
      this.unregisterCancelHotkey();
    }
    this.windows.overlay.webContents.send("state:update", displayedState);
    this.windows.settings.webContents.send("state:update", displayedState);
    this.onStateChanged?.(displayedState);
  }

  private publishNotice(severity: AppNotice["severity"], message: string): void {
    this.notice = { id: this.nextNoticeId++, severity, message };
    void this.broadcastSnapshot();
  }

  private openSettings(tab?: "practice"): void {
    this.windows.settings.show();
    this.windows.settings.focus();
    if (tab) this.windows.settings.webContents.send("practice:open");
  }

  private dismissNotice(): void {
    if (!this.notice) return;
    this.notice = undefined;
    void this.broadcastSnapshot();
  }

  private broadcast(channel: string, payload: unknown): void {
    this.windows.settings.webContents.send(channel, payload);
    this.windows.overlay.webContents.send(channel, payload);
  }

  private async broadcastSnapshot(progress?: number, activeModel?: LocalModel): Promise<void> {
    const snapshot = await this.snapshot();
    if (activeModel && progress !== undefined) {
      const model = snapshot.models.find((item) => item.id === activeModel);
      if (model) {
        model.downloading = true;
        model.progress = progress;
      }
    }
    this.broadcast("settings:changed", snapshot);
  }

  private clearRecordTimer(): void {
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.recordTimer = undefined;
  }

  private async disposePendingAudio(): Promise<void> {
    const audio = this.pendingAudio;
    this.pendingAudio = undefined;
    if (audio) await audio.dispose();
  }

  private async resetEphemeral(): Promise<void> {
    this.abort?.abort();
    this.abort = undefined;
    this.recoverableText = undefined;
    this.deliveryTarget = null;
    clearTimeout(this.recoveryTimer);
    this.clearRecordTimer();
    await this.disposePendingAudio();
  }
}

function refinementRejectionMessage(reason: RefinementRejectionReason): string {
  switch (reason) {
    case "empty":
      return "Refinement returned an empty result, so the Raw Transcript was pasted instead.";
    case "expanded":
      return "Refinement expanded the text unexpectedly, so the Raw Transcript was pasted instead.";
    case "protected-content-changed":
      return "Refinement changed a URL, email address, or number, so the Raw Transcript was pasted instead.";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
