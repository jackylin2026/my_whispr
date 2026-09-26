import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, LocalModel, PracticeState, RefinementLevel, Settings, SettingsSnapshot } from "../../shared/types";
import { AudioCapture } from "./audio-capture";
import {
  PracticeTranscriptComparison,
  type PracticeTranscriptComparisonHandle,
} from "./PracticeTranscriptComparison";
import { RenderedMarkdown } from "./RenderedMarkdown";
import { compareTranscriptWords } from "../../shared/transcript-comparison";

const IDLE: AppState = { phase: "idle", message: "Ready to dictate" };
type SettingsTab = "activation" | "transcription" | "refinement" | "practice" | "prompt";

const SETTINGS_TAB_HEADINGS: Record<SettingsTab, { title: string; description: string }> = {
  activation: {
    title: "Hot Keys Settings",
    description: "Setting the key to start & stop a dictation.",
  },
  transcription: {
    title: "Transcription Settings",
    description: "Select the transcription service provider.",
  },
  refinement: {
    title: "Refinement Settings",
    description: "Select the refinement service provider & refinement effort.",
  },
  practice: {
    title: "English Practice",
    description: "Record your English, Evaluate your English.",
  },
  prompt: {
    title: "Prompt Files",
    description: "Prompt files for refinement & practice",
  },
};

export function App(): React.JSX.Element {
  const kind = new URLSearchParams(window.location.search).get("window");
  if (kind === "settings") return <SettingsView />;
  return <Overlay />;
}

function Overlay(): React.JSX.Element {
  const [state, setState] = useState<AppState>(IDLE);
  const capture = useMemo(() => new AudioCapture(), []);

  useEffect(() => {
    const unsubscribeState = window.myWhispr.onState(setState);
    const unsubscribeStart = window.myWhispr.onCaptureStart(() => {
      console.info("capture start requested");
      const startedAt = performance.now();
      window.myWhispr.reportCaptureTiming("IPC received", 0);
      void capture.start((stage, elapsedMs) => window.myWhispr.reportCaptureTiming(stage, elapsedMs)).then(() => {
        window.myWhispr.reportCaptureTiming("ready total", performance.now() - startedAt);
      }).catch((error: unknown) => {
        console.error("capture start failed", error);
        void window.myWhispr.failCapture(error instanceof Error ? error.message : "Microphone unavailable");
      });
    });
    const unsubscribeStop = window.myWhispr.onCaptureStop(() => {
      console.info("capture stop requested");
      void capture
        .stop()
        .then((wav) => {
          console.info(`capture completed (${wav.byteLength} bytes)`);
          return window.myWhispr.completeCapture(wav);
        })
        .catch((error: unknown) => {
          console.error("capture stop failed", error);
          return window.myWhispr.failCapture(error instanceof Error ? error.message : "Unable to finish recording");
        });
    });
    const unsubscribeCancel = window.myWhispr.onCaptureCancel(() => void capture.cancel());
    return () => {
      unsubscribeState();
      unsubscribeStart();
      unsubscribeStop();
      unsubscribeCancel();
      void capture.cancel();
    };
  }, [capture]);

  return (
    <main className={`overlay phase-${state.phase}`}>
      <div className="pulse" aria-hidden="true" />
      <div className="overlay-copy">
        <strong>{state.message}</strong>
        {state.countdownSeconds !== undefined && <span>{state.countdownSeconds}s remaining</span>}
      </div>
      <div className="overlay-actions">
        {state.canRetry && <button onClick={() => void window.myWhispr.action("retry")}>Retry</button>}
        {state.canCopyAgain && <button onClick={() => void window.myWhispr.action("copy-again")}>Copy again</button>}
        {state.canDiscard && <button onClick={() => void window.myWhispr.action("discard")}>Discard</button>}
      </div>
    </main>
  );
}

function PracticePanel({
  active,
  dictationHotkey,
  practiceHotkey,
}: {
  active: boolean;
  dictationHotkey: string;
  practiceHotkey: string;
}): React.JSX.Element {
  const [state, setState] = useState<PracticeState>();
  const [editorText, setEditorText] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [comparisonSummary, setComparisonSummary] = useState("");
  const [recordingUrl, setRecordingUrl] = useState<string>();
  const [exampleUrl, setExampleUrl] = useState<string>();
  const [error, setError] = useState("");
  const [azureReady, setAzureReady] = useState(false);
  const goldenAudio = useRef(new Map<string, string>());
  const comparison = useRef<PracticeTranscriptComparisonHandle>(null);
  const correctionVersion = useRef(-1);

  useEffect(() => {
    void window.myWhispr.getPractice().then(acceptPracticeState);
    void window.myWhispr.getSettings().then((snapshot) => setAzureReady(snapshot.environment.hasAzureSpeech));
    return window.myWhispr.onPracticeChanged(acceptPracticeState);
  }, []);

  useEffect(() => {
    let disposed = false;
    void loadAudio("recording").then((url) => {
      if (!disposed) setRecordingUrl(url);
    });
    return () => { disposed = true; };
  }, [state?.recordingVersion]);

  useEffect(() => {
    let disposed = false;
    void loadAudio("example").then((url) => {
      if (!disposed) setExampleUrl(url);
    });
    return () => { disposed = true; };
  }, [state?.hasExampleAudio]);

  useEffect(() => () => {
    clearGoldenAudio();
  }, []);

  useEffect(() => {
    if (active) comparison.current?.refreshLayout();
  }, [active]);

  function acceptPracticeState(next: PracticeState): void {
    setState(next);
    if (next.correctionVersion === correctionVersion.current) return;
    correctionVersion.current = next.correctionVersion;
    const corrected = next.correctedTranscript ?? "";
    setEditorText(corrected);
    setIsDirty(false);
    setComparisonSummary(corrected && next.rawTranscript
      ? changedWordsLabel(compareTranscriptWords(next.rawTranscript, corrected).length)
      : "");
    clearGoldenAudio();
  }

  function clearGoldenAudio(): void {
    for (const url of goldenAudio.current.values()) URL.revokeObjectURL(url);
    goldenAudio.current.clear();
  }

  async function act(operation: () => Promise<PracticeState>): Promise<void> {
    try { setError(""); acceptPracticeState(await operation()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }

  async function analyzeLatestCorrection(): Promise<void> {
    const corrected = comparison.current?.getCorrectedTranscript() ?? editorText;
    try {
      setError("");
      comparison.current?.scrollToFirstChange();
      acceptPracticeState(await window.myWhispr.analyzePractice(corrected));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function editorChanged(text: string): void {
    setEditorText(text);
    setIsDirty(true);
    setComparisonSummary(changedWordsLabel(
      compareTranscriptWords(state?.rawTranscript ?? "", text).length,
    ));
    clearGoldenAudio();
  }

  async function loadAudio(kind: "recording" | "example"): Promise<string | undefined> {
    const bytes = await window.myWhispr.getPracticeAudio(kind);
    return bytes ? URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: "audio/wav" })) : undefined;
  }

  async function playGolden(word: string): Promise<void> {
    try {
      setError("");
      let url = goldenAudio.current.get(word);
      if (!url) {
        const bytes = await window.myWhispr.synthesizePracticeWord(word);
        url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: "audio/wav" }));
        goldenAudio.current.set(word, url);
      }
      await new Audio(url).play();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }

  if (!state) return <div className="practice"><p>Loading…</p></div>;
  return (
    <div className="practice" role="tabpanel">
      {!azureReady && <p className="credential-warning">Azure Speech is not configured. Run <code>npm run setup:azure-speech</code>; grammar feedback can still work without it.</p>}
      {!state.hasRecording ? (
        <section><h2>No Practice Session</h2><p>Press {dictationHotkey} to record a Dictation. The latest successful Dictation becomes available here.</p></section>
      ) : (
        <>
          <section className="practice-recording">
            <h2>Recording</h2>
            {recordingUrl && <audio controls src={recordingUrl} />}
          </section>
          <section className="practice-comparison">
            <h2>Transcript comparison</h2>
            {state.correctedTranscript === undefined ? (
              <p className="muted">Select the complete corrected passage in the source application, then press {practiceHotkey}.</p>
            ) : (
              <>
                <div className="comparison-headings" aria-hidden="true"><strong>Raw Transcript</strong><strong>Corrected Transcript</strong></div>
                <PracticeTranscriptComparison
                  ref={comparison}
                  rawTranscript={state.rawTranscript ?? ""}
                  correctedTranscript={state.correctedTranscript}
                  onChange={editorChanged}
                />
                <div className="practice-actions comparison-actions">
                  <button disabled={!editorText.trim() || state.phase === "analyzing"} onClick={() => void analyzeLatestCorrection()}>{state.phase === "analyzing" ? "Analyzing…" : "Analyze"}</button>
                  {comparisonSummary && <span className="comparison-summary" role="status">{comparisonSummary}</span>}
                </div>
              </>
            )}
            <div className="correction-guidance">
              <p>Correct only words Transcription misheard.</p>
              <p>In tmux, use Shift+drag to select the complete passage and {practiceHotkey} to replace the current selection.</p>
            </div>
          </section>
          {state.report && !isDirty && <PracticeReportView state={state} recordingUrl={recordingUrl} exampleUrl={exampleUrl} act={act} playGolden={playGolden} />}
        </>
      )}
      {(error || state.error) && <p className="practice-error">{error || state.error}</p>}
      {state.report?.errors.map((item) => <p className="credential-warning" key={item}>{item}</p>)}
      {state.hasRecording && <button className="quiet discard-practice" onClick={() => void act(() => window.myWhispr.discardPractice())}>Discard Practice Session</button>}
    </div>
  );
}

function changedWordsLabel(count: number): string {
  return `${count} changed ${count === 1 ? "word" : "words"}`;
}

function PracticeReportView({ state, recordingUrl, exampleUrl, act, playGolden }: { state: PracticeState; recordingUrl?: string; exampleUrl?: string; act: (operation: () => Promise<PracticeState>) => Promise<void>; playGolden: (word: string) => Promise<void> }): React.JSX.Element {
  const report = state.report!;
  function replay(offsetMs?: number, durationMs?: number): void {
    if (!recordingUrl || offsetMs === undefined) return;
    const audio = new Audio(recordingUrl);
    audio.currentTime = offsetMs / 1_000;
    void audio.play();
    if (durationMs) window.setTimeout(() => audio.pause(), durationMs + 350);
  }
  return <section><h2>Practice Report</h2>
    <div className="score-row">
      {report.pronunciationScore !== undefined && <span>Pronunciation <strong>{report.pronunciationScore}</strong></span>}
      {report.fluencyScore !== undefined && <span>Fluency <strong>{report.fluencyScore}</strong></span>}
      {report.prosodyScore !== undefined && <span>Prosody <strong>{report.prosodyScore}</strong></span>}
    </div>
    {report.recognitionDifferences?.length ? <>
      <h3>Recognition differences to review</h3>
      <p className="muted">These compare the Raw Transcript with your correction. They are words to review, not confirmed pronunciation errors.</p>
      {report.recognitionDifferences.map((difference, index) => <article className="feedback-card" key={`${difference.kind}-${difference.recognized}-${difference.corrected}-${index}`}>
        <strong>{difference.kind === "substitution" ? `${difference.recognized} → ${difference.corrected}` : difference.kind === "insertion" ? `Missing → ${difference.corrected}` : `Extra: ${difference.recognized}`}</strong>
        <small>{difference.kind === "substitution" ? "Transcription recognized the first phrase; you corrected it to the second." : difference.kind === "insertion" ? "This corrected word was missing from the Raw Transcript." : "This Raw Transcript word was removed in your correction."}</small>
        {difference.corrected && <div className="word-audio-actions"><button onClick={() => void playGolden(difference.corrected!)}>Golden</button><button className="quiet" disabled={difference.offsetMs === undefined} onClick={() => replay(difference.offsetMs, difference.durationMs)}>Mine</button></div>}
      </article>)}
    </> : null}
    {report.pronunciationFindings?.length ? <h3>Pronunciation suggestions</h3> : null}
    {report.pronunciationFindings?.map((finding) => <article className="feedback-card" key={`${finding.word}-${finding.accuracyScore}`}><strong>{finding.word}</strong><span>Review score: {finding.accuracyScore}</span>{finding.phonemes?.length ? <small>{finding.phonemes.map((item) => `${item.phoneme} ${item.accuracyScore}`).join(" · ")}</small> : null}<div className="word-audio-actions"><button onClick={() => void playGolden(finding.word)}>Golden</button><button className="quiet" disabled={finding.offsetMs === undefined} onClick={() => replay(finding.offsetMs, finding.durationMs)}>Mine</button></div></article>)}
    {report.pronunciationGuide && <RenderedMarkdown>{report.pronunciationGuide}</RenderedMarkdown>}
    {report.grammarFindings?.map((finding) => <article className="feedback-card" key={`${finding.original}-${finding.correction}`}><strong>{finding.optional ? "Style suggestion" : "Grammar"}</strong><span>{finding.original} → {finding.correction}</span><small>{finding.explanation}</small></article>)}
    {report.improvedExample && <><h3>American English example</h3><p className="transcript-block">{report.improvedExample}</p>{exampleUrl ? <audio controls src={exampleUrl} /> : <button onClick={() => void act(() => window.myWhispr.synthesizePracticeExample())}>Generate example speech</button>}</>}
  </section>;
}

function SettingsView(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [draftHotkey, setDraftHotkey] = useState("F8");
  const [draftPracticeHotkey, setDraftPracticeHotkey] = useState("Shift+F8");
  const [draftCancelHotkey, setDraftCancelHotkey] = useState("ESC");
  const [error, setError] = useState("");
  const [appState, setAppState] = useState<AppState>(IDLE);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("activation");
  const [practiceAvailable, setPracticeAvailable] = useState(false);
  const [practiceMounted, setPracticeMounted] = useState(false);
  const pendingDownloads = useRef(new Set<LocalModel>());
  const [pendingModels, setPendingModels] = useState<Set<LocalModel>>(new Set());

  useEffect(() => {
    void refresh();
    void window.myWhispr.getPractice().then((practice) => setPracticeAvailable(practice.hasRecording));
    const unsubscribeSettings = window.myWhispr.onSettingsChanged((next) => {
      setSnapshot(next);
      setDraftHotkey(next.settings.hotkey);
      setDraftPracticeHotkey(next.settings.practiceHotkey);
      setDraftCancelHotkey(next.settings.cancelHotkey);
    });
    const unsubscribeState = window.myWhispr.onState(setAppState);
    const unsubscribePractice = window.myWhispr.onPracticeChanged((practice) => {
      setPracticeAvailable(practice.hasRecording);
      if (!practice.hasRecording) {
        setSettingsTab((current) => current === "practice" ? "activation" : current);
      }
    });
    const unsubscribePracticeRequest = window.myWhispr.onPracticeRequested(() => {
      void window.myWhispr.getPractice().then((practice) => {
        setPracticeAvailable(practice.hasRecording);
        if (practice.hasRecording) {
          setPracticeMounted(true);
          setSettingsTab("practice");
        }
      });
    });
    return () => {
      unsubscribeSettings();
      unsubscribeState();
      unsubscribePractice();
      unsubscribePracticeRequest();
    };
  }, []);

  function selectSettingsTab(tab: SettingsTab): void {
    if (tab === "practice") {
      if (!practiceAvailable) return;
      setPracticeMounted(true);
    }
    setSettingsTab(tab);
  }

  async function refresh(): Promise<void> {
    const next = await window.myWhispr.getSettings();
    setSnapshot(next);
    setDraftHotkey(next.settings.hotkey);
    setDraftPracticeHotkey(next.settings.practiceHotkey);
    setDraftCancelHotkey(next.settings.cancelHotkey);
  }

  async function update(patch: Partial<Settings>): Promise<void> {
    try {
      setError("");
      const next = await window.myWhispr.updateSettings(patch);
      setSnapshot(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function manageRefinementPrompt(action: "open" | "reset", level: RefinementLevel): Promise<void> {
    if (
      action === "reset" &&
      !window.confirm(`Replace ${level}_refine_prompt.md with the shipped default?`)
    ) return;
    try {
      setError("");
      if (action === "open") await window.myWhispr.openRefinementPrompt(level);
      else await window.myWhispr.resetRefinementPrompt(level);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function managePracticePrompt(action: "open" | "reset", kind: "grammar" | "pronunciation"): Promise<void> {
    if (action === "reset" && !window.confirm(`Restore the shipped ${kind} coaching prompt?`)) return;
    try {
      setError("");
      if (action === "open") await window.myWhispr.openPracticePrompt(kind);
      else await window.myWhispr.resetPracticePrompt(kind);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function selectModel(model: LocalModel): Promise<void> {
    await update({ localModel: model });
    const installed = snapshot?.models.find((item) => item.id === model)?.installed;
    if (!installed) await download(model);
  }

  async function download(model: LocalModel): Promise<void> {
    if (pendingDownloads.current.has(model)) return;
    pendingDownloads.current.add(model);
    setPendingModels(new Set(pendingDownloads.current));
    try {
      setError("");
      await window.myWhispr.downloadModel(model);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      pendingDownloads.current.delete(model);
      setPendingModels(new Set(pendingDownloads.current));
    }
  }

  async function remove(model: LocalModel): Promise<void> {
    await window.myWhispr.removeModel(model);
    await refresh();
  }

  if (!snapshot) return <main className="settings"><p>Loading…</p></main>;
  const { settings, models, environment, notice } = snapshot;
  const selectedRefinementKeyAvailable = {
    openai: environment.hasOpenAiKey,
    cerebras: environment.hasCerebrasKey,
  }[settings.refinementProvider];
  const refinementProviderLabel = { openai: "OpenAI", cerebras: "Cerebras" }[settings.refinementProvider];
  const heading = SETTINGS_TAB_HEADINGS[settingsTab];

  return (
    <main className="settings">
      <header>
        <p className="eyebrow">MY WHISPR</p>
        <h1>{heading.title}</h1>
        <p className="muted">{heading.description}</p>
      </header>

      <div className="settings-tabs" role="tablist" aria-label="Dictation services">
          <button
            className={settingsTab === "activation" ? "settings-tab active" : "settings-tab"}
            role="tab"
            aria-selected={settingsTab === "activation"}
            onClick={() => selectSettingsTab("activation")}
          >
            Hot keys
          </button>
          <button
            className={settingsTab === "transcription" ? "settings-tab active" : "settings-tab"}
            role="tab"
            aria-selected={settingsTab === "transcription"}
            onClick={() => selectSettingsTab("transcription")}
          >
            Transcription
          </button>
          <button
            className={settingsTab === "refinement" ? "settings-tab active" : "settings-tab"}
            role="tab"
            aria-selected={settingsTab === "refinement"}
            onClick={() => selectSettingsTab("refinement")}
          >
            Refinement
          </button>
          <button
            className={settingsTab === "practice" ? "settings-tab active" : "settings-tab"}
            role="tab"
            aria-selected={settingsTab === "practice"}
            disabled={!practiceAvailable}
            onClick={() => selectSettingsTab("practice")}
          >
            Practice
          </button>
          <button
            className={settingsTab === "prompt" ? "settings-tab active" : "settings-tab"}
            role="tab"
            aria-selected={settingsTab === "prompt"}
            onClick={() => selectSettingsTab("prompt")}
          >
            Prompt
          </button>
      </div>

      <section className={settingsTab === "practice" ? "tab-panel-card practice-tab-card" : settingsTab === "prompt" ? "tab-panel-card prompt-tab-card" : "tab-panel-card"}>
        {settingsTab === "activation" ? (
          <div className="settings-tab-panel" role="tabpanel">
            <label>
              Start/Stop dictation keys
              <div className="inline-control">
                <input value={draftHotkey} onChange={(event) => setDraftHotkey(event.target.value)} />
                <button onClick={() => void update({ hotkey: draftHotkey })}>Save</button>
              </div>
            </label>
            <label>
              Practice activation keys
              <div className="inline-control">
                <input value={draftPracticeHotkey} onChange={(event) => setDraftPracticeHotkey(event.target.value)} />
                <button onClick={() => void update({ practiceHotkey: draftPracticeHotkey })}>Save</button>
              </div>
            </label>
            <label>
              Cancelation keys
              <div className="inline-control">
                <input value={draftCancelHotkey} onChange={(event) => setDraftCancelHotkey(event.target.value)} />
                <button onClick={() => void update({ cancelHotkey: draftCancelHotkey })}>Save</button>
              </div>
            </label>
            <label>
              Paste shortcut
              <select
                value={settings.pasteShortcutMode}
                onChange={(event) =>
                  void update({
                    pasteShortcutMode: event.target.value as Settings["pasteShortcutMode"],
                  })
                }
              >
                <option value="automatic">Automatic (recommended)</option>
                <option value="standard">Standard · Ctrl+V</option>
                <option value="terminal">Terminal · Ctrl+Shift+V</option>
              </select>
              <small>
                Automatic detects terminal windows. Choose Terminal if tmux or a terminal app receives Ctrl+V.
              </small>
            </label>
          </div>
        ) : settingsTab === "transcription" ? (
          <div className="settings-tab-panel" role="tabpanel">
            <div className="service-options">
              <label className={settings.transcriptionMode === "local" ? "service-option selected" : "service-option"}>
                <input
                  type="radio"
                  name="transcription-service"
                  checked={settings.transcriptionMode === "local"}
                  onChange={() => void update({ transcriptionMode: "local" })}
                />
                <span>
                  <strong>Local Whisper.cpp</strong>
                  <small>Audio stays on this machine</small>
                </span>
              </label>
              <label className={settings.transcriptionMode === "cloud" ? "service-option selected" : "service-option"}>
                <input
                  type="radio"
                  name="transcription-service"
                  checked={settings.transcriptionMode === "cloud"}
                  disabled={!environment.hasOpenAiKey}
                  onChange={() => void update({ transcriptionMode: "cloud" })}
                />
                <span>
                  <strong>OpenAI cloud</strong>
                  <small>Audio is sent to OpenAI</small>
                </span>
              </label>
              <label className={settings.transcriptionMode === "azure" ? "service-option selected" : "service-option"}>
                <input
                  type="radio"
                  name="transcription-service"
                  checked={settings.transcriptionMode === "azure"}
                  disabled={!environment.hasAzureSpeech}
                  onChange={() => void update({ transcriptionMode: "azure" })}
                />
                <span>
                  <strong>Azure Speech</strong>
                  <small>Audio is sent to Azure · American English</small>
                </span>
              </label>
            </div>

            {!environment.hasOpenAiKey && (
              <p className="credential-warning"><code>OPENAI_API_KEY</code> is missing; OpenAI transcription is disabled.</p>
            )}
            {!environment.hasAzureSpeech && (
              <p className="credential-warning">Azure transcription needs <code>AZURE_SPEECH_KEY</code> and <code>AZURE_SPEECH_REGION</code>. Run <code>npm run setup:azure-speech</code>, then restart the app.</p>
            )}

            {settings.transcriptionMode === "local" && (
              <div className="local-models">
                <h3>Whisper.cpp model</h3>
                <div className="model-list">
                  {models.map((model) => (
                    <article className={settings.localModel === model.id ? "model selected" : "model"} key={model.id}>
                      <label>
                        <input
                          type="radio"
                          name="model"
                          checked={settings.localModel === model.id}
                          onChange={() => void selectModel(model.id)}
                        />
                        <span>
                          <strong>{model.label}</strong>
                          <small>{model.installed ? "Installed" : model.downloading || pendingModels.has(model.id) ? `Downloading ${Math.round((model.progress ?? 0) * 100)}%` : "Not installed"}</small>
                        </span>
                      </label>
                      {model.installed ? (
                        <button className="quiet" onClick={() => void remove(model.id)}>Remove</button>
                      ) : (
                        <button className="quiet" disabled={model.downloading || pendingModels.has(model.id)} onClick={() => void download(model.id)}>Download</button>
                      )}
                    </article>
                  ))}
                </div>
                {!environment.whisperServerAvailable && (
                  <p className="credential-warning">Local engine missing. Run <code>npm run setup:whisper</code>.</p>
                )}
              </div>
            )}
          </div>
        ) : settingsTab === "refinement" ? (
          <div className="settings-tab-panel" role="tabpanel">
            <div className="service-options refinement-levels">
              {([
                ["off", "Off", "Deliver the Raw Transcript"],
                ["light", "Light", "Clean speech while keeping your wording"],
                ["medium", "Medium", "Rewrite awkward speech for fluent, concise text"],
              ] as const).map(([mode, label, description]) => (
                <label className={settings.refinementMode === mode ? "service-option selected" : "service-option"} key={mode}>
                  <input
                    type="radio"
                    name="refinement-mode"
                    checked={settings.refinementMode === mode}
                    disabled={mode !== "off" && !selectedRefinementKeyAvailable}
                    onChange={() => void update({ refinementMode: mode })}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </div>

            <div className="service-options">
              <label className={settings.refinementProvider === "openai" ? "service-option selected" : "service-option"}>
                <input
                  type="radio"
                  name="refinement-provider"
                  checked={settings.refinementProvider === "openai"}
                  disabled={!environment.hasOpenAiKey}
                  onChange={() => void update({ refinementProvider: "openai" })}
                />
                <span>
                  <strong>OpenAI</strong>
                  <small>Refine with gpt-4o-mini</small>
                </span>
              </label>
              <label className={settings.refinementProvider === "cerebras" ? "service-option selected" : "service-option"}>
                <input
                  type="radio"
                  name="refinement-provider"
                  checked={settings.refinementProvider === "cerebras"}
                  disabled={!environment.hasCerebrasKey}
                  onChange={() => void update({ refinementProvider: "cerebras" })}
                />
                <span>
                  <strong>Cerebras</strong>
                  <small>Refine with gpt-oss-120b · low reasoning</small>
                </span>
              </label>
            </div>

            {!environment.hasOpenAiKey && (
              <p className="credential-warning"><code>OPENAI_API_KEY</code> is missing; OpenAI Refinement is disabled.</p>
            )}
            {!environment.hasCerebrasKey && (
              <p className="credential-warning"><code>CEREBRAS_API_KEY</code> is missing; Cerebras Refinement is disabled.</p>
            )}
            <p className="privacy-summary">
              {settings.refinementMode !== "off"
                ? `Raw Transcript sent to ${refinementProviderLabel} for ${settings.refinementMode === "light" ? "Light" : "Medium"} Refinement`
                : "Refinement is off; the Raw Transcript is pasted directly"}
            </p>
          </div>
        ) : settingsTab === "prompt" ? (
          <div className="settings-tab-panel prompt-panel" role="tabpanel">
            <section className="prompt-group">
              <h2>Refinement prompts</h2>
              <p className="muted">Instructions used for Light and Medium Refinement.</p>
              <div className="prompt-files">
                {(["light", "medium"] as const).map((level) => (
                  <div className="prompt-file" key={level}>
                    <code>{level}_refine_prompt.md</code>
                    <span>
                      <button className="quiet" onClick={() => void manageRefinementPrompt("open", level)}>Open</button>
                      <button className="quiet" onClick={() => void manageRefinementPrompt("reset", level)}>Reset</button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <section className="prompt-group">
              <h2>Practice coaching prompts</h2>
              <p className="muted">Instructions used to generate grammar and pronunciation coaching.</p>
              <div className="prompt-files">
                {(["grammar", "pronunciation"] as const).map((kind) => (
                  <div className="prompt-file" key={kind}>
                    <code>practice_{kind}_prompt.md</code>
                    <span>
                      <button className="quiet" onClick={() => void managePracticePrompt("open", kind)}>Open</button>
                      <button className="quiet" onClick={() => void managePracticePrompt("reset", kind)}>Reset</button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}
        {practiceMounted && (
          <div hidden={settingsTab !== "practice"}>
            <PracticePanel
              active={settingsTab === "practice"}
              dictationHotkey={settings.hotkey}
              practiceHotkey={settings.practiceHotkey}
            />
          </div>
        )}
      </section>

      <footer
        className={`settings-status ${error ? "error" : notice?.severity ?? "ready"}`}
        role={error || notice ? "alert" : "status"}
      >
        <div className="status-copy">
          {(error || notice) && (
            <strong>{error || notice?.severity === "error" ? "Error" : "Warning"}</strong>
          )}
          <span>
            {error || notice?.message || (environment.hasXdotool ? "Ready · Automatic paste available" : "Ready · Clipboard delivery only; xdotool is missing")}
          </span>
        </div>
        <div className="status-actions">
          {!error && notice && appState.phase === "error" && appState.canRetry && (
            <button onClick={() => void window.myWhispr.action("retry")}>Retry</button>
          )}
          {!error && notice && appState.phase === "error" && appState.canDiscard && (
            <button className="quiet" onClick={() => void window.myWhispr.action("discard")}>Discard</button>
          )}
          {error ? (
            <button className="quiet" onClick={() => setError("")}>Dismiss</button>
          ) : notice ? (
            <button className="quiet" onClick={() => void window.myWhispr.action("dismiss-notice")}>Dismiss</button>
          ) : null}
        </div>
      </footer>
    </main>
  );
}
