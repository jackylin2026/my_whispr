import { describe, expect, it, vi } from "vitest";
import { PracticeCoach } from "../src/main/practice-coach";
import { PracticePromptStore } from "../src/main/practice-prompt-store";

const defaults = { grammar: "grammar prompt", pronunciation: "pronunciation prompt" };
const prompts = new PracticePromptStore("/missing", defaults);

describe("Practice Coach", () => {
  it("combines pronunciation and grammar feedback", async () => {
    const azure = { assess: vi.fn(async () => ({ pronunciationScore: 82, pronunciationFindings: [] })) };
    const complete = vi.fn(async () => JSON.stringify({
      findings: [{ original: "I goed", correction: "I went", explanation: "Irregular past tense." }],
      improvedExample: "I went home.",
    }));
    const report = await new PracticeCoach(prompts, azure, complete).analyze(
      "audio.wav", "I goed home.", "I goed home.", new AbortController().signal,
    );
    expect(report).toMatchObject({ pronunciationScore: 82, improvedExample: "I went home.", errors: [] });
  });

  it("returns grammar feedback when pronunciation fails", async () => {
    const azure = { assess: vi.fn(async () => { throw new Error("Azure unavailable"); }) };
    const complete = vi.fn(async () => JSON.stringify({ findings: [], improvedExample: "Clear example." }));
    const report = await new PracticeCoach(prompts, azure, complete).analyze(
      "audio.wav", "Clear example.", "Clear example.", new AbortController().signal,
    );
    expect(report.improvedExample).toBe("Clear example.");
    expect(report.errors[0]).toContain("Azure unavailable");
  });
});
