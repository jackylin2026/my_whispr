import type { PracticeReport, PracticeState } from "../shared/types";

export interface PracticeAudio {
  path: string;
  dispose(): Promise<void>;
}

export interface PracticeAnalysisInput {
  audioPath: string;
  rawTranscript: string;
  correctedTranscript: string;
}

export class PracticeSession {
  private audio?: PracticeAudio;
  private rawTranscript?: string;
  private correctedTranscript?: string;
  private report?: PracticeReport;
  private error?: string;
  private exampleAudio?: PracticeAudio;
  private abort?: AbortController;
  private phase: PracticeState["phase"] = "idle";
  private revision = 0;
  private recordingVersion = 0;
  private correctionVersion = 0;

  constructor(private readonly changed?: (state: PracticeState) => void) {}

  snapshot(): PracticeState {
    return {
      phase: this.phase,
      recordingVersion: this.recordingVersion,
      correctionVersion: this.correctionVersion,
      rawTranscript: this.rawTranscript,
      correctedTranscript: this.correctedTranscript,
      hasRecording: Boolean(this.audio),
      hasExampleAudio: Boolean(this.exampleAudio),
      report: this.report,
      error: this.error,
    };
  }

  async replace(audio: PracticeAudio, rawTranscript: string): Promise<PracticeState> {
    this.revision += 1;
    this.recordingVersion += 1;
    this.correctionVersion += 1;
    this.abort?.abort();
    await this.disposeAudio();
    this.audio = audio;
    this.rawTranscript = rawTranscript;
    this.correctedTranscript = undefined;
    this.report = undefined;
    this.error = undefined;
    await this.disposeExampleAudio();
    this.phase = "awaiting-correction";
    return this.publish();
  }

  async updateCorrection(text: string): Promise<PracticeState> {
    if (!this.audio || !this.rawTranscript) throw new Error("Record a Practice Dictation first");
    if (!text.trim()) throw new Error("Select the corrected transcript first");
    this.revision += 1;
    this.correctionVersion += 1;
    this.abort?.abort();
    this.abort = undefined;
    this.correctedTranscript = text;
    this.report = undefined;
    this.error = undefined;
    await this.disposeExampleAudio();
    this.phase = "preview";
    return this.publish();
  }

  async analyze(analyzer: (input: PracticeAnalysisInput, signal: AbortSignal) => Promise<PracticeReport>): Promise<PracticeState> {
    if (!this.audio || !this.rawTranscript || !this.correctedTranscript) throw new Error("Confirm a corrected transcript first");
    if (this.phase === "analyzing") return this.snapshot();
    this.abort?.abort();
    this.abort = new AbortController();
    const abort = this.abort;
    const revision = ++this.revision;
    this.phase = "analyzing";
    this.error = undefined;
    this.publish();
    try {
      const report = await analyzer({ audioPath: this.audio.path, rawTranscript: this.rawTranscript, correctedTranscript: this.correctedTranscript }, abort.signal);
      if (revision !== this.revision) return this.snapshot();
      this.report = report;
      this.phase = "ready";
    } catch (error) {
      if (revision !== this.revision) return this.snapshot();
      if (abort.signal.aborted) this.phase = "preview";
      else {
        this.error = error instanceof Error ? error.message : String(error);
        this.phase = "error";
      }
    }
    return this.publish();
  }

  recordingPath(): string | undefined { return this.audio?.path; }
  examplePath(): string | undefined { return this.exampleAudio?.path; }
  async setExampleAudio(audio: PracticeAudio): Promise<PracticeState> {
    await this.disposeExampleAudio();
    this.exampleAudio = audio;
    return this.publish();
  }
  exampleText(): string | undefined { return this.report?.improvedExample; }
  hasPronunciationWord(word: string): boolean {
    return Boolean(
      this.report?.pronunciationFindings?.some((finding) => finding.word === word) ||
      this.report?.recognitionDifferences?.some((difference) => difference.corrected === word),
    );
  }

  async discard(publish = true): Promise<PracticeState> {
    this.revision += 1;
    this.recordingVersion += 1;
    this.correctionVersion += 1;
    this.abort?.abort();
    this.abort = undefined;
    await this.disposeAudio();
    this.rawTranscript = undefined;
    this.correctedTranscript = undefined;
    this.report = undefined;
    this.error = undefined;
    await this.disposeExampleAudio();
    this.phase = "idle";
    return publish ? this.publish() : this.snapshot();
  }

  private async disposeAudio(): Promise<void> {
    const audio = this.audio;
    this.audio = undefined;
    if (audio) await audio.dispose();
  }

  private async disposeExampleAudio(): Promise<void> {
    const audio = this.exampleAudio;
    this.exampleAudio = undefined;
    if (audio) await audio.dispose();
  }

  private publish(): PracticeState {
    const state = this.snapshot();
    this.changed?.(state);
    return state;
  }
}
