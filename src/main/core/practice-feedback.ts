import type { PronunciationFinding, RecognitionDifference } from "../../shared/types";
import {
  compareTranscriptWords,
  normalizeTranscriptWord,
  transcriptWords,
  type TranscriptWord,
  type TranscriptWordChange,
} from "../../shared/transcript-comparison";

export function lowScoringPronunciationFindings(
  words: PronunciationFinding[],
  threshold = 70,
): PronunciationFinding[] {
  return words
    .filter((word) => word.accuracyScore < threshold)
    .sort((left, right) => left.accuracyScore - right.accuracyScore);
}

export function buildRecognitionDifferences(
  rawTranscript: string,
  correctedTranscript: string,
  assessedWords: PronunciationFinding[],
): RecognitionDifference[] {
  const corrected = transcriptWords(correctedTranscript);
  const timings = correctedTimings(corrected, assessedWords);
  const groups = new Map<number, TranscriptWordChange[]>();
  for (const change of compareTranscriptWords(rawTranscript, correctedTranscript)) {
    const group = groups.get(change.group) ?? [];
    group.push(change);
    groups.set(change.group, group);
  }
  return [...groups.values()].flatMap((changes) => {
    const rawWords = changes.flatMap((change) => change.raw ? [change.raw] : []);
    const correctedWords = changes.flatMap((change) => change.corrected ? [change.corrected] : []);
    if (
      rawWords.length &&
      correctedWords.length &&
      rawWords.length !== correctedWords.length &&
      resemblesSplitPhrase(rawWords, correctedWords)
    ) {
      const timing = phraseTiming(correctedWords, corrected, timings);
      return [{
        kind: "substitution",
        recognized: rawWords.map((word) => word.text).join(" "),
        corrected: correctedWords.map((word) => word.text).join(" "),
        offsetMs: timing?.offsetMs,
        durationMs: timing?.durationMs,
      } satisfies RecognitionDifference];
    }
    return changes.map((change) => atomicDifference(change, corrected, timings));
  });
}

function atomicDifference(
  change: TranscriptWordChange,
  corrected: TranscriptWord[],
  timings: Array<PronunciationFinding | undefined>,
): RecognitionDifference {
  const correctedIndex = change.corrected
    ? corrected.findIndex((word) => word.from === change.corrected!.from)
    : -1;
  const timing = correctedIndex >= 0 ? timings[correctedIndex] : undefined;
  return {
    kind: change.kind,
    recognized: change.raw?.text,
    corrected: change.corrected?.text,
    offsetMs: timing?.offsetMs,
    durationMs: timing?.durationMs,
  };
}

function resemblesSplitPhrase(raw: TranscriptWord[], corrected: TranscriptWord[]): boolean {
  const rawPhrase = raw.map((word) => word.normalized).join("");
  const correctedPhrase = corrected.map((word) => word.normalized).join("");
  const longest = Math.max(rawPhrase.length, correctedPhrase.length);
  // Whisper can collapse a short phrase into one similar-looking word
  // ("clean code" -> "clinical"). Keep unrelated inserted words separate.
  return longest > 0 && 1 - editDistance(rawPhrase, correctedPhrase) / longest >= 0.3;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function phraseTiming(
  words: TranscriptWord[],
  corrected: TranscriptWord[],
  timings: Array<PronunciationFinding | undefined>,
): Pick<PronunciationFinding, "offsetMs" | "durationMs"> | undefined {
  const phraseTimings = words
    .map((word) => timings[corrected.findIndex((candidate) => candidate.from === word.from)])
    .filter((timing): timing is PronunciationFinding => timing !== undefined);
  const first = phraseTimings[0];
  if (!first) return undefined;
  const last = phraseTimings.at(-1)!;
  const durationMs = first.offsetMs !== undefined && last.offsetMs !== undefined
    ? last.offsetMs + (last.durationMs ?? 0) - first.offsetMs
    : first.durationMs;
  return { offsetMs: first.offsetMs, durationMs };
}

function correctedTimings(corrected: TranscriptWord[], assessedWords: PronunciationFinding[]): Array<PronunciationFinding | undefined> {
  const byWord = new Map<string, PronunciationFinding[]>();
  for (const word of assessedWords) {
    const key = normalizeTranscriptWord(word.word);
    const values = byWord.get(key) ?? [];
    values.push(word);
    byWord.set(key, values);
  }
  return corrected.map((token) => byWord.get(token.normalized)?.shift());
}
