import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DictationController } from "../src/main/controller";
import { AzureSpeechClient } from "../src/main/azure-speech-client";
import { OpenAiClient } from "../src/main/openai-client";
import { CerebrasClient } from "../src/main/cerebras-client";
import { DeliveryService } from "../src/main/delivery";
import { ModelManager } from "../src/main/model-manager";
import { PracticeSession } from "../src/main/practice-session";
import { PracticePromptStore } from "../src/main/practice-prompt-store";
import { RefinementPromptStore } from "../src/main/refinement-prompt-store";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/main/settings-store";
import { TempFiles } from "../src/main/temp-files";
import { WhisperServer } from "../src/main/whisper-server";
import type { RefinementMode, RefinementProvider, Settings, TranscriptionMode } from "../src/shared/types";

vi.mock("electron", () => ({
  app: {},
  clipboard: {},
  ClipboardItem: class {},
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn(), unregisterAll: vi.fn() },
}));

const raw = "I um went home.";
const refined = "I went home.";
let controller: DictationController;

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  for (const [name, value] of Object.entries({
    OPENAI_API_KEY: "openai-test-key",
    CEREBRAS_API_KEY: "cerebras-test-key",
    AZURE_SPEECH_KEY: "speech-test-key",
    AZURE_SPEECH_REGION: "eastus",
  })) vi.stubEnv(name, value);
});

afterEach(async () => {
  await controller?.shutdown();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function setup(patch: Partial<Settings>) {
  const store = new SettingsStore("/unused/settings.json");
  vi.spyOn(store, "get").mockReturnValue({ ...DEFAULT_SETTINGS, ...patch });
  const models = new ModelManager("/unused/models");
  vi.spyOn(models, "states").mockResolvedValue([]);
  vi.spyOn(models, "isInstalled").mockResolvedValue(true);
  const temp = new TempFiles("/unused/audio");
  vi.spyOn(temp, "purge").mockResolvedValue();
  vi.spyOn(temp, "createWav").mockResolvedValue({ path: "/unused/recording.wav", dispose: vi.fn(async () => undefined) });
  const delivery = new DeliveryService();
  vi.spyOn(delivery, "activeTarget").mockResolvedValue({ windowId: "123" });
  const deliver = vi.spyOn(delivery, "deliver").mockResolvedValue(true);
  const prompts = new RefinementPromptStore("/unused/prompts", { light: "Light prompt", medium: "Medium prompt" });
  vi.spyOn(prompts, "build").mockResolvedValue({ source: "file", request: { instructions: "Fix speech artifacts.", input: raw } });
  const practice = new PracticeSession();
  const window = { show: vi.fn(), focus: vi.fn(), webContents: { send: vi.fn() } };
  controller = new DictationController(
    { settings: window as unknown as BrowserWindow, overlay: window as unknown as BrowserWindow },
    store, models, temp, delivery, prompts, practice,
    new PracticePromptStore("/unused/prompts", { grammar: "Grammar prompt", pronunciation: "Pronunciation prompt" }),
    process.execPath,
  );
  const transcribers = {
    local: vi.spyOn(WhisperServer.prototype, "transcribe").mockResolvedValue(raw),
    cloud: vi.spyOn(OpenAiClient.prototype, "transcribe").mockResolvedValue(raw),
    azure: vi.spyOn(AzureSpeechClient.prototype, "transcribe").mockResolvedValue(raw),
  };
  const refiners = {
    openai: vi.spyOn(OpenAiClient.prototype, "refine").mockResolvedValue(refined),
    cerebras: vi.spyOn(CerebrasClient.prototype, "refine").mockResolvedValue(refined),
  };
  return { deliver, transcribers, refiners, practice };
}

async function dictate() {
  await controller.action("start");
  await controller.action("stop");
  await controller.completeCapture(new Uint8Array([1, 2, 3]));
}

describe("Dictation provider routing", () => {
  it.each<[TranscriptionMode, RefinementMode, RefinementProvider]>([
    ["azure", "off", "cerebras"],
    ["cloud", "light", "openai"],
    ["local", "medium", "cerebras"],
    ["azure", "light", "openai"],
    ["azure", "light", "cerebras"],
  ])("uses %s transcription with %s refinement from %s", async (transcriptionMode, refinementMode, refinementProvider) => {
    const { deliver, transcribers, refiners } = setup({ transcriptionMode, refinementMode, refinementProvider });
    await dictate();
    for (const [name, transcribe] of Object.entries(transcribers)) {
      expect(transcribe).toHaveBeenCalledTimes(name === transcriptionMode ? 1 : 0);
    }
    for (const [name, refine] of Object.entries(refiners)) {
      expect(refine).toHaveBeenCalledTimes(refinementMode !== "off" && name === refinementProvider ? 1 : 0);
    }
    expect(deliver).toHaveBeenCalledWith({ windowId: "123" }, refinementMode === "off" ? raw : refined, "automatic");
    expect(controller.practiceSnapshot()).toMatchObject({ hasRecording: true, rawTranscript: raw });
  });

  it("keeps the Azure Raw Transcript and reports a warning after a refinement failure", async () => {
    const { deliver, refiners } = setup({ transcriptionMode: "azure", refinementMode: "light", refinementProvider: "cerebras" });
    refiners.cerebras.mockRejectedValue(new Error("Cerebras refinement failed: HTTP 429"));
    await dictate();
    expect(deliver).toHaveBeenCalledWith(expect.anything(), raw, "automatic");
    expect((await controller.snapshot()).notice).toMatchObject({ severity: "warning", message: expect.stringContaining("HTTP 429") });
    expect(refiners.openai).not.toHaveBeenCalled();
  });

  it("does not paste Azure no-speech results", async () => {
    const { deliver, transcribers } = setup({ transcriptionMode: "azure" });
    transcribers.azure.mockRejectedValue(new Error("No speech detected"));
    await dictate();
    expect(deliver).not.toHaveBeenCalled();
    expect((await controller.snapshot()).notice).toMatchObject({ message: "No speech detected" });
    expect(controller.practiceSnapshot().hasRecording).toBe(false);
  });

  it("requires Speech credentials for Azure transcription", async () => {
    const { deliver, transcribers } = setup({ transcriptionMode: "azure" });
    vi.stubEnv("AZURE_SPEECH_KEY", "");
    await dictate();
    expect(transcribers.azure).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect((await controller.snapshot()).notice?.message).toContain("Azure Speech is not configured");
  });

  it("reports incomplete Refinement configuration independently from Speech", async () => {
    const { deliver, refiners } = setup({ transcriptionMode: "azure", refinementMode: "light", refinementProvider: "cerebras" });
    vi.stubEnv("CEREBRAS_API_KEY", "");
    await dictate();
    const snapshot = await controller.snapshot();
    expect(snapshot.environment).toMatchObject({ hasAzureSpeech: true, hasCerebrasKey: false });
    expect(snapshot.notice?.message).toContain("CEREBRAS_API_KEY");
    expect(deliver).toHaveBeenCalledWith(expect.anything(), raw, "automatic");
    expect(refiners.cerebras).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain("test-key");
  });

  it("uses the selected provider for Practice grammar and pronunciation coaching", async () => {
    const { refiners, practice } = setup({ refinementProvider: "cerebras" });
    await practice.replace({ path: "recording.wav", dispose: vi.fn(async () => undefined) }, raw);
    vi.spyOn(AzureSpeechClient.prototype, "assess").mockResolvedValue({ pronunciationFindings: [{ word: "went", accuracyScore: 60 }] });
    refiners.cerebras
      .mockResolvedValueOnce(JSON.stringify({ findings: [], improvedExample: refined }))
      .mockResolvedValueOnce("Practice the vowel in went.");
    const result = await controller.analyzePractice(raw);
    expect(result.report).toMatchObject({ improvedExample: refined, pronunciationGuide: "Practice the vowel in went.", errors: [] });
    expect(refiners.cerebras).toHaveBeenCalledTimes(2);
    expect(refiners.openai).not.toHaveBeenCalled();
  });
});
