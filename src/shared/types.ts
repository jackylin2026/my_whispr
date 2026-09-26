export type DictationPhase =
  | "idle"
  | "recording"
  | "stopping"
  | "transcribing"
  | "refining"
  | "delivering"
  | "recoverable"
  | "error";

export type TranscriptionMode = "local" | "cloud" | "azure";
export type LocalModel = "base.en" | "small.en";
export type RefinementProvider = "openai" | "cerebras";
export type PasteShortcutMode = "automatic" | "standard" | "terminal";
export type RefinementLevel = "light" | "medium";
export type RefinementMode = "off" | RefinementLevel;
export type PracticePhase = "idle" | "awaiting-correction" | "preview" | "analyzing" | "ready" | "error";
export type PracticePromptKind = "grammar" | "pronunciation";

export interface Settings {
  version: 5;
  hotkey: string;
  practiceHotkey: string;
  cancelHotkey: string;
  pasteShortcutMode: PasteShortcutMode;
  transcriptionMode: TranscriptionMode;
  localModel: LocalModel;
  refinementMode: RefinementMode;
  refinementProvider: RefinementProvider;
}

export interface AppState {
  phase: DictationPhase;
  message: string;
  countdownSeconds?: number;
  canRetry?: boolean;
  canDiscard?: boolean;
  canCopyAgain?: boolean;
}

export interface ModelState {
  id: LocalModel;
  label: string;
  sizeBytes: number;
  installed: boolean;
  downloading: boolean;
  progress?: number;
  error?: string;
}

export interface EnvironmentState {
  hasOpenAiKey: boolean;
  hasCerebrasKey: boolean;
  hasXdotool: boolean;
  whisperServerAvailable: boolean;
  hasAzureSpeech: boolean;
}

export interface GrammarFinding {
  original: string;
  correction: string;
  explanation: string;
  optional?: boolean;
}

export interface PronunciationFinding {
  word: string;
  accuracyScore: number;
  errorType?: string;
  offsetMs?: number;
  durationMs?: number;
  phonemes?: Array<{ phoneme: string; accuracyScore: number }>;
}

export interface RecognitionDifference {
  kind: "substitution" | "insertion" | "deletion";
  recognized?: string;
  corrected?: string;
  offsetMs?: number;
  durationMs?: number;
}

export interface PracticeReport {
  grammarFindings?: GrammarFinding[];
  improvedExample?: string;
  pronunciationScore?: number;
  fluencyScore?: number;
  prosodyScore?: number;
  pronunciationFindings?: PronunciationFinding[];
  recognitionDifferences?: RecognitionDifference[];
  pronunciationGuide?: string;
  errors: string[];
}

export interface PracticeState {
  phase: PracticePhase;
  recordingVersion: number;
  correctionVersion: number;
  rawTranscript?: string;
  correctedTranscript?: string;
  hasRecording: boolean;
  hasExampleAudio: boolean;
  report?: PracticeReport;
  error?: string;
}

export interface AppNotice {
  id: number;
  severity: "warning" | "error";
  message: string;
}

export interface SettingsSnapshot {
  settings: Settings;
  models: ModelState[];
  environment: EnvironmentState;
  notice?: AppNotice;
}

export type AppAction = "start" | "stop" | "cancel" | "retry" | "discard" | "copy-again" | "dismiss-notice";

export interface MyWhisprApi {
  getSettings(): Promise<SettingsSnapshot>;
  updateSettings(patch: Partial<Settings>): Promise<SettingsSnapshot>;
  downloadModel(model: LocalModel): Promise<void>;
  removeModel(model: LocalModel): Promise<void>;
  action(action: AppAction): Promise<void>;
  completeCapture(wav: Uint8Array): Promise<void>;
  failCapture(message: string): Promise<void>;
  reportCaptureTiming(stage: string, elapsedMs: number): void;
  onState(listener: (state: AppState) => void): () => void;
  onCaptureStart(listener: () => void): () => void;
  onCaptureStop(listener: () => void): () => void;
  onCaptureCancel(listener: () => void): () => void;
  onSettingsChanged(listener: (snapshot: SettingsSnapshot) => void): () => void;
  openRefinementPrompt(level: RefinementLevel): Promise<void>;
  resetRefinementPrompt(level: RefinementLevel): Promise<void>;
  getPractice(): Promise<PracticeState>;
  updatePracticeCorrection(correctedTranscript: string): Promise<PracticeState>;
  analyzePractice(correctedTranscript: string): Promise<PracticeState>;
  discardPractice(): Promise<PracticeState>;
  synthesizePracticeExample(): Promise<PracticeState>;
  synthesizePracticeWord(word: string): Promise<Uint8Array>;
  getPracticeAudio(kind: "recording" | "example"): Promise<Uint8Array | null>;
  onPracticeChanged(listener: (state: PracticeState) => void): () => void;
  onPracticeRequested(listener: () => void): () => void;
  openPracticePrompt(kind: PracticePromptKind): Promise<void>;
  resetPracticePrompt(kind: PracticePromptKind): Promise<void>;
}
