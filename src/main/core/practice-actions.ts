export function parseCorrectedTranscript(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error("Invalid Corrected Transcript");
}
