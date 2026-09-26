import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCorrectedTranscript } from "../src/main/core/practice-actions";

describe("Practice interface", () => {
  it("rejects invalid correction actions", () => {
    expect(parseCorrectedTranscript("Correct words only.")).toBe("Correct words only.");
    expect(() => parseCorrectedTranscript(null)).toThrow("Invalid Corrected Transcript");
    expect(() => parseCorrectedTranscript({ text: "not allowed" })).toThrow("Invalid Corrected Transcript");
  });

  it("does not expose selection or clipboard correction capture to the renderer", async () => {
    const files = await Promise.all([
      readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/types.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
    ]);
    const interfaceSource = files.join("\n");
    expect(interfaceSource).not.toContain("practice:capture-selection");
    expect(interfaceSource).not.toContain("capturePracticeSelection");
    expect(interfaceSource).not.toContain("Use copied text");
  });

  it("has no Practice mode, tray action, or standalone Practice window", async () => {
    const files = await Promise.all([
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/main/controller.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/types.ts", import.meta.url), "utf8"),
    ]);
    const source = files.join("\n");
    expect(source).not.toContain("Practice mode");
    expect(source).not.toContain("Open Practice");
    expect(source).not.toContain("practiceWindow");
    expect(source).not.toContain("setPracticeEnabled");
    expect(source).not.toContain("practice:set-enabled");
    expect(source).not.toContain("practice.isEnabled()");
    expect(source).toContain("await this.practice.replace(audio, raw)");
  });

  it("keeps comparison live without a manual Recompare action", async () => {
    const practiceView = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    expect(practiceView).not.toContain(">Recompare<");
    expect(practiceView).toContain("compareTranscriptWords(state?.rawTranscript ?? \"\", text)");
  });

  it("hosts Practice as a session-gated Settings tab", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain('disabled={!practiceAvailable}');
    expect(app).toContain('onPracticeRequested');
    expect(app).toContain('setSettingsTab("practice")');
    expect(app).not.toContain('kind === "practice"');
  });
});
