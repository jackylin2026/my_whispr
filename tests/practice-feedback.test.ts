import { describe, expect, it } from "vitest";
import {
  buildRecognitionDifferences,
  lowScoringPronunciationFindings,
} from "../src/main/core/practice-feedback";

const raw = "Someone whose marine is stranded when a Sarah's bow is washed up on the shore of a deserted island after peace storm boasts a Sarah and a bow of marine.";
const corrected = "Someone who's marooned is stranded. When a sailor's boat is washed up on the shore of a deserted island after a big storm, both the sailor and the boat are marooned.";

describe("Practice feedback", () => {
  it("keeps every Azure word below the review threshold", () => {
    const words = [
      { word: "washed", accuracyScore: 21 },
      { word: "sailor's", accuracyScore: 23 },
      { word: "boat", accuracyScore: 46 },
      { word: "big", accuracyScore: 46 },
      { word: "sailor", accuracyScore: 62 },
      { word: "marooned", accuracyScore: 94 },
    ];
    expect(lowScoringPronunciationFindings(words).map((item) => item.word)).toEqual([
      "washed", "sailor's", "boat", "big", "sailor",
    ]);
  });

  it("separates Raw-to-Corrected recognition differences and attaches corrected-word timing", () => {
    const assessedWords = [
      { word: "marooned", accuracyScore: 94, offsetMs: 2700, durationMs: 1000 },
      { word: "big", accuracyScore: 46, offsetMs: 11880, durationMs: 230 },
      { word: "both", accuracyScore: 100, offsetMs: 12740, durationMs: 360 },
    ];
    const differences = buildRecognitionDifferences(raw, corrected, assessedWords);
    expect(differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ recognized: "marine", corrected: "marooned", offsetMs: 2700 }),
      expect.objectContaining({ recognized: "peace", corrected: "big", offsetMs: 11880 }),
      expect.objectContaining({ recognized: "boasts", corrected: "both", offsetMs: 12740 }),
    ]));
  });

  it("reports a split recognition as one phrase substitution", () => {
    const assessedWords = [
      { word: "clean", accuracyScore: 80, offsetMs: 100, durationMs: 200 },
      { word: "code", accuracyScore: 85, offsetMs: 350, durationMs: 150 },
    ];
    expect(buildRecognitionDifferences("clinical", "clean code", assessedWords)).toEqual([
      {
        kind: "substitution",
        recognized: "clinical",
        corrected: "clean code",
        offsetMs: 100,
        durationMs: 400,
      },
    ]);
  });

  it("keeps unrelated added words separate", () => {
    expect(buildRecognitionDifferences("peace", "a big", [])).toEqual([
      expect.objectContaining({ kind: "insertion", corrected: "a" }),
      expect.objectContaining({ kind: "substitution", recognized: "peace", corrected: "big" }),
    ]);
  });
});
