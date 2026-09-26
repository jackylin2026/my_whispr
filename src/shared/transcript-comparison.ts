export interface TranscriptWord {
  text: string;
  normalized: string;
  from: number;
  to: number;
}

export interface TranscriptWordChange {
  kind: "substitution" | "insertion" | "deletion";
  raw?: TranscriptWord;
  corrected?: TranscriptWord;
  group: number;
}

/**
 * Align transcript words without changing the text shown to the user.
 * Capitalization, straight/curly apostrophes, and punctuation-only edits do
 * not count as recognition differences.
 */
export function compareTranscriptWords(
  rawTranscript: string,
  correctedTranscript: string,
): TranscriptWordChange[] {
  const raw = transcriptWords(rawTranscript);
  const corrected = transcriptWords(correctedTranscript);
  const costs = Array.from({ length: raw.length + 1 }, () =>
    Array<number>(corrected.length + 1).fill(0),
  );
  for (let row = 0; row <= raw.length; row += 1) costs[row][0] = row;
  for (let column = 0; column <= corrected.length; column += 1) costs[0][column] = column;
  for (let row = 1; row <= raw.length; row += 1) {
    for (let column = 1; column <= corrected.length; column += 1) {
      costs[row][column] = Math.min(
        costs[row - 1][column] + 1,
        costs[row][column - 1] + 1,
        costs[row - 1][column - 1] +
          (raw[row - 1].normalized === corrected[column - 1].normalized ? 0 : 1),
      );
    }
  }

  const steps: Array<Omit<TranscriptWordChange, "group"> | undefined> = [];
  let row = raw.length;
  let column = corrected.length;
  while (row || column) {
    if (
      row && column &&
      raw[row - 1].normalized === corrected[column - 1].normalized &&
      costs[row][column] === costs[row - 1][column - 1]
    ) {
      steps.unshift(undefined);
      row -= 1;
      column -= 1;
    } else if (row && column && costs[row][column] === costs[row - 1][column - 1] + 1) {
      steps.unshift({
        kind: "substitution",
        raw: raw[row - 1],
        corrected: corrected[column - 1],
      });
      row -= 1;
      column -= 1;
    } else if (row && costs[row][column] === costs[row - 1][column] + 1) {
      steps.unshift({ kind: "deletion", raw: raw[row - 1] });
      row -= 1;
    } else {
      steps.unshift({ kind: "insertion", corrected: corrected[column - 1] });
      column -= 1;
    }
  }
  let group = -1;
  let insideChange = false;
  return steps.flatMap((step) => {
    if (!step) {
      insideChange = false;
      return [];
    }
    if (!insideChange) group += 1;
    insideChange = true;
    return [{ ...step, group }];
  });
}

export function transcriptWords(text: string): TranscriptWord[] {
  return [...text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?|\d+(?:[.:/-]\d+)*/g)].map(
    (match) => ({
      text: match[0],
      normalized: normalizeTranscriptWord(match[0]),
      from: match.index,
      to: match.index + match[0].length,
    }),
  );
}

export function normalizeTranscriptWord(word: string): string {
  return word.toLowerCase().replace(/’/g, "'");
}
