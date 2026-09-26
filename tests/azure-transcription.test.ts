import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureSpeechClient } from "../src/main/azure-speech-client";

const speech = vi.hoisted(() => ({
  config: { speechRecognitionLanguage: "" },
  recognizer: {
    recognized: undefined as undefined | ((sender: unknown, event: { result: { reason: number; text: string } }) => void),
    canceled: undefined as undefined | ((sender: unknown, event: { reason: number; errorCode: number; errorDetails: string }) => void),
    sessionStopped: undefined as undefined | (() => void),
    startContinuousRecognitionAsync: vi.fn<(success?: () => void, error?: (message: string) => void) => void>(),
    stopContinuousRecognitionAsync: vi.fn(),
    close: vi.fn(),
  },
  fromSubscription: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => Buffer.from("wav")), writeFile: vi.fn() }));
vi.mock("microsoft-cognitiveservices-speech-sdk", () => ({
  SpeechConfig: { fromSubscription: speech.fromSubscription },
  AudioConfig: { fromWavFileInput: vi.fn() },
  SpeechRecognizer: class { constructor() { return speech.recognizer; } },
  ResultReason: { RecognizedSpeech: 3, NoMatch: 0 },
  CancellationReason: { EndOfStream: 1 },
}));

const client = () => new AzureSpeechClient("speech-key", "eastus");
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFile).mockResolvedValue(Buffer.from("wav"));
  speech.fromSubscription.mockReturnValue(speech.config);
});

describe("Azure continuous transcription", () => {
  it("collects multiple utterances through end-of-stream", async () => {
    speech.recognizer.startContinuousRecognitionAsync.mockImplementation(() => {
      speech.recognizer.recognized?.(null, { result: { reason: 3, text: " First sentence. " } });
      speech.recognizer.recognized?.(null, { result: { reason: 0, text: "" } });
      speech.recognizer.recognized?.(null, { result: { reason: 3, text: "Second sentence." } });
      speech.recognizer.canceled?.(null, { reason: 1, errorCode: 0, errorDetails: "" });
    });
    await expect(client().transcribe("dictation.wav", signal())).resolves.toBe("First sentence. Second sentence.");
    expect(speech.fromSubscription).toHaveBeenCalledWith("speech-key", "eastus");
    expect(speech.config.speechRecognitionLanguage).toBe("en-US");
    expect(speech.recognizer.close).toHaveBeenCalledOnce();
  });

  it("treats an empty session as no speech", async () => {
    speech.recognizer.startContinuousRecognitionAsync.mockImplementation(() => speech.recognizer.sessionStopped?.());
    await expect(client().transcribe("silent.wav", signal())).rejects.toThrow("No speech detected");
    expect(speech.recognizer.close).toHaveBeenCalledOnce();
  });

  it("rejects service failures with transcription-specific diagnostics", async () => {
    speech.recognizer.startContinuousRecognitionAsync.mockImplementation(() => {
      speech.recognizer.canceled?.(null, { reason: 0, errorCode: 4, errorDetails: "connection failed" });
    });
    await expect(client().transcribe("dictation.wav", signal())).rejects.toThrow("Azure transcription canceled");
    expect(speech.recognizer.close).toHaveBeenCalledOnce();
  });

  it("does not read audio or start a request that has already been canceled", async () => {
    await expect(client().transcribe("dictation.wav", AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(readFile).not.toHaveBeenCalled();
    expect(speech.fromSubscription).not.toHaveBeenCalled();
  });

  it("stops and closes recognition when canceled without retaining its abort listener", async () => {
    const abort = new AbortController();
    const removeListener = vi.spyOn(abort.signal, "removeEventListener");
    speech.recognizer.startContinuousRecognitionAsync.mockImplementation(() => abort.abort());
    await expect(client().transcribe("dictation.wav", abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(speech.recognizer.stopContinuousRecognitionAsync).toHaveBeenCalledOnce();
    expect(speech.recognizer.close).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("normalizes SDK startup errors and closes the recognizer", async () => {
    speech.recognizer.startContinuousRecognitionAsync.mockImplementation((_success, error) => error?.("cannot start"));
    await expect(client().transcribe("dictation.wav", signal())).rejects.toThrow("cannot start");
    expect(speech.recognizer.close).toHaveBeenCalledOnce();
  });
});
