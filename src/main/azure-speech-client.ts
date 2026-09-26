import { readFile, writeFile } from "node:fs/promises";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import type { PracticeReport, PronunciationFinding } from "../shared/types";
import { lowScoringPronunciationFindings } from "./core/practice-feedback";

export interface AzurePronunciationResult extends Partial<PracticeReport> {
  assessedWords?: PronunciationFinding[];
}

export class AzureSpeechClient {
  constructor(
    private readonly key: string,
    private readonly region: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async assess(wavPath: string, referenceText: string, signal: AbortSignal): Promise<AzurePronunciationResult> {
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(this.key, this.region);
    speechConfig.speechRecognitionLanguage = "en-US";
    speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
    const audio = SpeechSDK.AudioConfig.fromWavFileInput(await readFile(wavPath));
    const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audio);
    const assessment = new SpeechSDK.PronunciationAssessmentConfig(
      referenceText,
      SpeechSDK.PronunciationAssessmentGradingSystem.HundredMark,
      SpeechSDK.PronunciationAssessmentGranularity.Phoneme,
      false,
    );
    assessment.phonemeAlphabet = "IPA";
    assessment.enableProsodyAssessment = true;
    assessment.applyTo(recognizer);

    const segments: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => recognizer.stopContinuousRecognitionAsync(resolve, reject);
      signal.addEventListener("abort", abort, { once: true });
      recognizer.recognized = (_sender, event) => {
        if (event.result.reason !== SpeechSDK.ResultReason.RecognizedSpeech) return;
        const json = event.result.properties.getProperty(SpeechSDK.PropertyId.SpeechServiceResponse_JsonResult);
        if (json) segments.push(JSON.parse(json));
      };
      recognizer.canceled = (_sender, event) => {
        const error = azureCancellationError(event.reason, event.errorCode, event.errorDetails);
        if (error) reject(error);
        else resolve();
      };
      recognizer.sessionStopped = () => resolve();
      recognizer.startContinuousRecognitionAsync(undefined, reject);
    }).finally(() => recognizer.close());
    if (signal.aborted) throw new DOMException("Practice analysis canceled", "AbortError");
    return aggregateAssessment(segments);
  }

  async transcribe(wavPath: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const wav = await readFile(wavPath);
    signal.throwIfAborted();
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(this.key, this.region);
    speechConfig.speechRecognitionLanguage = "en-US";
    const audio = SpeechSDK.AudioConfig.fromWavFileInput(wav);
    const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audio);
    const segments: string[] = [];
    let abort: () => void;
    await new Promise<void>((resolve, reject) => {
      abort = (): void => {
        recognizer.stopContinuousRecognitionAsync();
        reject(new DOMException("Azure transcription canceled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      recognizer.recognized = (_sender, event) => {
        if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && event.result.text.trim()) {
          segments.push(event.result.text.trim());
        }
      };
      recognizer.canceled = (_sender, event) => {
        const error = azureCancellationError(event.reason, event.errorCode, event.errorDetails, "transcription");
        if (error) reject(error);
        else resolve();
      };
      recognizer.sessionStopped = () => resolve();
      recognizer.startContinuousRecognitionAsync(undefined, (error) => reject(new Error(String(error))));
    }).finally(() => {
      signal.removeEventListener("abort", abort);
      recognizer.close();
    });
    if (signal.aborted) throw new DOMException("Azure transcription canceled", "AbortError");
    const transcript = segments.join(" ").trim();
    if (!transcript) throw new Error("No speech detected");
    return transcript;
  }

  async synthesize(text: string, outputPath: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetcher(`https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      signal,
      headers: {
        "Ocp-Apim-Subscription-Key": this.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        "User-Agent": "MyWhispr",
      },
      body: `<speak version="1.0" xml:lang="en-US"><voice name="en-US-JennyNeural">${escapeXml(text)}</voice></speak>`,
    });
    if (!response.ok) throw new Error(`Azure example speech failed: HTTP ${response.status}`);
    await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
  }
}

function aggregateAssessment(segments: any[]): AzurePronunciationResult {
  const scores: Array<{ pronunciation?: number; fluency?: number; prosody?: number }> = [];
  const assessedWords: PronunciationFinding[] = [];
  for (const segment of segments) {
    const best = segment.NBest?.[0];
    const summary = best?.PronunciationAssessment;
    if (summary) scores.push({ pronunciation: summary.PronScore, fluency: summary.FluencyScore, prosody: summary.ProsodyScore });
    for (const word of best?.Words ?? []) {
      const value = word.PronunciationAssessment;
      if (!value) continue;
      assessedWords.push({
        word: word.Word,
        accuracyScore: value.AccuracyScore,
        errorType: value.ErrorType,
        offsetMs: typeof word.Offset === "number" ? word.Offset / 10_000 : undefined,
        durationMs: typeof word.Duration === "number" ? word.Duration / 10_000 : undefined,
        phonemes: (word.Phonemes ?? []).map((item: any) => ({ phoneme: item.Phoneme, accuracyScore: item.PronunciationAssessment?.AccuracyScore ?? 0 })),
      });
    }
  }
  const average = (key: "pronunciation" | "fluency" | "prosody"): number | undefined => {
    const values = scores.map((score) => score[key]).filter((value): value is number => typeof value === "number");
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : undefined;
  };
  return {
    pronunciationScore: average("pronunciation"),
    fluencyScore: average("fluency"),
    prosodyScore: average("prosody"),
    pronunciationFindings: lowScoringPronunciationFindings(assessedWords),
    assessedWords,
  };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function azureCancellationError(
  reason: number, code: number, details: string, operation = "pronunciation assessment",
): Error | undefined {
  if (reason === SpeechSDK.CancellationReason.EndOfStream) return undefined;
  return new Error(`Azure ${operation} canceled (reason=${reason}, code=${code}): ${details || "no details"}`);
}
