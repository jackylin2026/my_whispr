import type { GrammarFinding, PracticeReport } from "../shared/types";
import type { RefinementRequest } from "./core/refinement";
import type { AzureSpeechClient } from "./azure-speech-client";
import { buildRecognitionDifferences } from "./core/practice-feedback";
import type { PracticePromptStore } from "./practice-prompt-store";

type CompleteText = (request: RefinementRequest, signal?: AbortSignal) => Promise<string>;

export class PracticeCoach {
  constructor(
    private readonly prompts: PracticePromptStore,
    private readonly azure: Pick<AzureSpeechClient, "assess">,
    private readonly completeText: CompleteText,
  ) {}

  async analyze(audioPath: string, rawTranscript: string, correctedTranscript: string, signal: AbortSignal): Promise<PracticeReport> {
    const errors: string[] = [];
    const [pronunciation, grammar] = await Promise.allSettled([
      this.azure.assess(audioPath, correctedTranscript, signal),
      this.grammar(correctedTranscript, signal),
    ]);
    const report: PracticeReport = { errors };
    if (pronunciation.status === "fulfilled") {
      const { assessedWords, ...visibleAssessment } = pronunciation.value;
      Object.assign(report, visibleAssessment);
      report.recognitionDifferences = buildRecognitionDifferences(
        rawTranscript,
        correctedTranscript,
        assessedWords ?? [],
      );
    }
    else errors.push(`Pronunciation feedback failed: ${message(pronunciation.reason)}`);
    if (grammar.status === "fulfilled") Object.assign(report, grammar.value);
    else errors.push(`Grammar feedback failed: ${message(grammar.reason)}`);

    if (pronunciation.status === "fulfilled" && pronunciation.value.pronunciationFindings?.length) {
      try {
        report.pronunciationGuide = await this.completeText({
          instructions: await this.prompts.load("pronunciation"),
          input: JSON.stringify({ correctedTranscript, assessment: pronunciation.value }),
        }, signal);
      } catch (error) {
        errors.push(`Pronunciation guide failed: ${message(error)}`);
      }
    }
    if (!report.grammarFindings && !report.pronunciationFindings && errors.length) {
      throw new Error(errors.join(" "));
    }
    return report;
  }

  private async grammar(correctedTranscript: string, signal: AbortSignal): Promise<{ grammarFindings: GrammarFinding[]; improvedExample: string }> {
    const response = await this.completeText({
      instructions: await this.prompts.load("grammar"),
      input: `<corrected_transcript>\n${correctedTranscript}\n</corrected_transcript>`,
    }, signal);
    const parsed = JSON.parse(response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as {
      findings?: GrammarFinding[];
      improvedExample?: string;
    };
    if (!Array.isArray(parsed.findings) || typeof parsed.improvedExample !== "string") {
      throw new Error("Grammar provider returned an invalid report");
    }
    return { grammarFindings: parsed.findings.slice(0, 3), improvedExample: parsed.improvedExample.trim() };
  }

}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
