import { describe, expect, it } from "vitest";
import { compareTranscriptWords } from "../src/shared/transcript-comparison";

const compact = (raw: string, corrected: string) =>
  compareTranscriptWords(raw, corrected).map((change) => ({
    kind: change.kind,
    raw: change.raw?.text,
    corrected: change.corrected?.text,
  }));

describe("transcript word comparison", () => {
  it("aligns substitutions, insertions, and deletions", () => {
    expect(compact("I goed home", "I went home")).toEqual([
      { kind: "substitution", raw: "goed", corrected: "went" },
    ]);
    expect(compact("I went home", "I quickly went home")).toEqual([
      { kind: "insertion", raw: undefined, corrected: "quickly" },
    ]);
    expect(compact("I went home now", "I went home")).toEqual([
      { kind: "deletion", raw: "now", corrected: undefined },
    ]);
  });

  it("ignores capitalization, punctuation-only changes, and apostrophe style", () => {
    expect(compact("Hello, I can't.", "hello! I can’t")).toEqual([]);
  });

  it("preserves exact offsets across multiple lines", () => {
    const changes = compareTranscriptWords("One fish\ntwo fish", "One fish\nblue fish");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "substitution",
      raw: { text: "two", from: 9, to: 12 },
      corrected: { text: "blue", from: 9, to: 13 },
    });
  });

  it("aligns repeated words deterministically", () => {
    expect(compact("very very good", "very good")).toEqual([
      { kind: "deletion", raw: "very", corrected: undefined },
    ]);
  });
});
