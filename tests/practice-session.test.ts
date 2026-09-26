import { describe, expect, it, vi } from "vitest";
import { PracticeSession } from "../src/main/practice-session";

const audio = (path: string) => ({ path, dispose: vi.fn(async () => undefined) });

describe("Practice Session", () => {
  it("retains one recording through preview and analysis", async () => {
    const session = new PracticeSession();
    await session.replace(audio("first.wav"), "I goed home.");
    expect(await session.updateCorrection("I went home.")).toMatchObject({ phase: "preview", correctedTranscript: "I went home." });
    const ready = await session.analyze(async () => ({
      grammarFindings: [{ original: "goed", correction: "went", explanation: "Use the irregular past tense." }],
      improvedExample: "I went home.",
      pronunciationFindings: [{ word: "went", accuracyScore: 62 }],
      errors: [],
    }));
    expect(ready).toMatchObject({ phase: "ready", hasRecording: true });
    expect(session.hasPronunciationWord("went")).toBe(true);
    expect(session.hasPronunciationWord("invented")).toBe(false);
  });

  it("disposes the old recording on replacement and the current recording on discard", async () => {
    const first = audio("first.wav");
    const second = audio("second.wav");
    const session = new PracticeSession();
    const initialVersion = (await session.replace(first, "First")).recordingVersion;
    await session.updateCorrection("Corrected first");
    expect(session.snapshot().recordingVersion).toBe(initialVersion);
    await session.replace(second, "Second");
    expect(session.snapshot().recordingVersion).toBe(initialVersion + 1);
    expect(first.dispose).toHaveBeenCalledOnce();
    await session.discard();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(session.snapshot()).toMatchObject({ phase: "idle", hasRecording: false });
  });

  it("rejects empty corrections and preserves a session after failed analysis", async () => {
    const session = new PracticeSession();
    await session.replace(audio("first.wav"), "Raw");
    await expect(session.updateCorrection(" ")).rejects.toThrow("Select the corrected transcript");
    await session.updateCorrection("Raw");
    const failed = await session.analyze(async () => { throw new Error("offline"); });
    expect(failed).toMatchObject({ phase: "error", hasRecording: true, error: "offline" });
  });

  it("invalidates feedback and example audio when the correction is replaced", async () => {
    const session = new PracticeSession();
    const example = audio("example.wav");
    await session.replace(audio("first.wav"), "The row transcript");
    await session.updateCorrection("The raw transcript");
    await session.analyze(async () => ({ improvedExample: "The raw transcript.", errors: [] }));
    await session.setExampleAudio(example);

    const updated = await session.updateCorrection("The right transcript");

    expect(updated).toMatchObject({
      phase: "preview",
      correctedTranscript: "The right transcript",
      hasExampleAudio: false,
    });
    expect(updated.report).toBeUndefined();
    expect(example.dispose).toHaveBeenCalledOnce();
  });
});
