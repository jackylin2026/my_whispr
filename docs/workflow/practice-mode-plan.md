# English Practice Workflow

## Summary

Every successful Dictation becomes the latest temporary Practice Session while continuing to use the configured Transcription and Refinement settings. After correcting only recognition mistakes, the user selects the complete transcript and presses the configured Practice activation shortcut (`Shift+F8` by default) to open the Practice tab in Settings and request American English feedback.

Feedback combines Azure pronunciation assessment, grammar coaching from the configured text provider, and playable American example speech.

## Practice workflow

1. Press the configured Start/Stop Dictation shortcut (`F8` by default) to record and stop using the configured Transcription and Refinement settings.
2. My Whispr pastes the selected transcript and retains the original WAV plus Raw Transcript as the latest Practice Session.
3. Correct only words Whisper misheard in the editor or terminal.
4. Select the whole corrected passage. In GNOME Terminal or tmux, use `Shift` while dragging so the terminal owns the selection.
5. Press the configured Practice activation shortcut. My Whispr reads Linux's selection clipboard, opens Settings, and activates the Practice tab containing the captured selection, Raw Transcript, and recording playback.
6. Confirm Analyze, then review grammar and pronunciation suggestions plus a playable American English example.

Empty selections are rejected. The Practice activation shortcut replaces an incorrect selection capture. The configured cancellation shortcut cancels active Dictation work.

## Analysis and report

- Keep the existing lossless 16 kHz mono WAV. Do not add MP3 compression.
- Use Azure Speech with locale `en-US`, the corrected verbatim transcript as `ReferenceText`, phoneme granularity, IPA output, and prosody enabled. Use continuous SDK processing for recordings over 30 seconds.
- Treat provider scores as automated suggestions to review, not definitive accent judgments. Whisper disagreements alone never establish pronunciation errors.
- Use the configured Cerebras/OpenAI provider with a separate coaching prompt for grammar findings, explanations, minimal corrections, and a natural example.
- Separate grammar errors from optional style suggestions and show up to three priorities initially.
- Generate example speech on demand with Azure `en-US-JennyNeural`.
- Preserve partial results when one provider fails.

## Architecture and lifecycle

- Introduce a Practice Session module that owns the retained audio, original and corrected transcripts, analysis state, results, cancellation, and example audio.
- Expose fixed typed Practice actions through preload; credentials and paths remain in the main process.
- Keep only one temporary session. Delete its files on replacement, discard, exit, and startup cleanup after a crash.
- Keep transcripts and reports in memory; do not add persistent Practice history.
- Add editable root Markdown prompts for grammar and pronunciation coaching using the existing prompt fallback/Open/Reset conventions.
- Add a repeatable Azure setup wizard. It guides the human through creating a US Azure subscription and Speech resource and stores `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in the ignored `.env`.

## Validation

- Test session replacement, discard, cancellation, late responses, retries, startup cleanup, and unchanged normal dictation behavior.
- Test Settings-tab activation, selection clipboard isolation, replacement capture, empty/stale selection behavior, and invalid IPC arguments.
- Test Azure and text adapters with mocked success, malformed response, timeout, missing-credential, and partial-failure cases.
- Verify the live editor, GNOME Terminal, and tmux selection flow.
- Pilot 10–20 genuine recordings, including clips over 30 seconds, before choosing score thresholds.
- Complete type checking, tests, build, and the full desktop flow.

## Defaults and boundaries

- American English; initial Azure region East US, subject to resource availability.
- The Practice tab is disabled until a successful Dictation exists; there are no Practice tray controls.
- Practice uses the configured Local or Cloud Transcription and optional Refinement.
- Upload begins only after explicit Analyze; example synthesis begins only after explicit playback request.
- Repeated-attempt progress tracking and persistent history are deferred.
