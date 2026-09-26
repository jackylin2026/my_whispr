# My Whispr

A focused personal dictation tool inspired by OpenWhispr. My Whispr listens on a configurable global shortcut, transcribes natural-language English locally or through OpenAI or Azure Speech, optionally refines the text, and pastes it back into the application where dictation began.

The v1 target is Ubuntu GNOME on X11. It intentionally has no history, meetings, notes, voice assistant, code-dictation language, telemetry, or account system.

## Prerequisites

- Node.js and npm
- A C++ compiler and CMake, for the local `whisper.cpp` engine
- `/usr/bin/xdotool` and `/usr/bin/xprop`, for identifying the target window, returning focus, and pasting on X11
- A working default microphone
- An OpenAI API key only if OpenAI Cloud Transcription or OpenAI Refinement is enabled
- A Cerebras API key only if Cerebras Refinement is enabled
- An Azure Speech key and region for Azure Transcription or Practice pronunciation features

## Setup

```bash
npm install
npm run setup:whisper
cp .env.example .env
npm run dev
```

Add `OPENAI_API_KEY` to `.env` for OpenAI Cloud Transcription or OpenAI Refinement, and `CEREBRAS_API_KEY` for Cerebras Refinement. The file is ignored by Git. My Whispr defaults to Local Transcription with Refinement off, so no key is required for the default workflow.

Azure Speech supports Cloud Transcription and English Practice pronunciation assessment and example audio. Configure `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`, or run the interactive setup wizard:

```bash
npm run setup:azure-speech
```

Restart the app after changing `.env`, then choose **Azure Speech** under Settings → Transcription. Refinement supports OpenAI and Cerebras independently of the transcription provider. The selected Refinement provider also handles Practice grammar coaching. Missing credentials disable the corresponding option, and Refinement failures retain the Raw Transcript with a warning in the Settings status bar.

Refinement has two levels: Light removes speech artifacts and repairs grammar while keeping the speaker's wording; Medium may rephrase unambiguous speech for fluent, concise writing. Refinement and Practice coaching prompts can be opened and reset from the Prompt tab; changes apply to the next Dictation or Practice analysis.

The first local Dictation downloads the selected English model and verifies its pinned SHA-256 checksum:

- `base.en`: faster, approximately 142 MiB
- `small.en`: more accurate, approximately 466 MiB

Downloaded models live in Electron's per-user application-data directory, not this repository.

## Usage

- Press the configured Start/Stop Dictation shortcut (`F8` by default) to begin recording.
- The tray microphone turns red while recording; no recording bar appears.
- Press the same shortcut again to transcribe and paste.
- Press the configured cancellation shortcut (`Escape` by default) during active work to cancel and delete temporary data.
- Open the tray menu for Settings, model management, and Quit.

For English Practice, dictate and correct only words Transcription misheard. Select the complete corrected transcript and press the configured Practice activation shortcut (`Shift+F8` by default) to open the Practice tab in Settings before analysis. In GNOME Terminal or tmux, hold `Shift` while dragging so the terminal owns the selection. The latest successful Dictation is kept temporarily for Practice and is deleted when discarded, replaced, or the app exits.

The Start/Stop Dictation, Practice activation, and cancellation shortcuts are configurable. Their defaults are `F8`, `Shift+F8`, and `Escape`. When you save a shortcut, My Whispr asks the X server to register or probe it before releasing the current binding. If it is already in use, unavailable, or assigned to another My Whispr action, the current binding remains active and Settings shows an error; the owning application cannot be identified. The cancellation shortcut is held globally only while a Dictation is active. Dictations stop automatically after five minutes. My Whispr uses the operating system's default input device.

Paste shortcut detection is automatic. Terminal windows such as GNOME Terminal receive `Ctrl+Shift+V`; other applications receive `Ctrl+V`. If detection is unavailable, select a fixed shortcut under Settings → Hot keys → Paste shortcut.

After pasting, the previous clipboard is restored only if the clipboard still contains My Whispr's text. A five-second `Copy again` tray action provides recovery without retaining transcript history.

## Development

```bash
npm run typecheck
npm test
npm run build
```

With `OPENAI_API_KEY` configured, exercise Cloud Transcription against Whisper's bundled JFK sample:

```bash
npm run test:openai
```

This makes one OpenAI Cloud Transcription request. With `CEREBRAS_API_KEY` configured, exercise the real Refinement adapter separately:

```bash
npm run test:cerebras
```

This makes one Cerebras `gpt-oss-120b` request using low reasoning effort.

To compare the active Light and Medium prompt files against configured providers, run the opt-in live evaluation:

```bash
npm run eval:refinement -- --provider=both
```

Use `openai` or `cerebras` instead of `both` to test one provider. This command makes live API calls and is not part of `npm run check`.

Or run all three checks with:

```bash
npm run check
```

## Architecture

- Electron main process: lifecycle, global shortcuts, Dictation state machine, model downloads, transcription, clipboard, and X11 Delivery
- Sandboxed preload: narrow typed IPC API
- React renderer: hidden microphone capture and Settings
- `whisper.cpp` sidecar: persistent CPU-based Local Transcription
- OpenAI: optional Cloud Transcription and optional Refinement with `gpt-4o-mini`
- Cerebras: optional low-latency Refinement with `gpt-oss-120b`
- Azure Speech: optional Cloud Transcription, American English pronunciation assessment, and `en-US-JennyNeural` example speech

See [CONTEXT.md](./CONTEXT.md) for canonical domain language and [docs/adr](./docs/adr/) for architectural decisions.

## Privacy

- Local Transcription with Refinement off makes no processing request to a cloud service.
- Cloud Transcription sends audio to the selected provider, OpenAI or Azure Speech.
- Refinement sends the Raw Transcript to the selected provider—OpenAI or Cerebras—even when Transcription is local.
- Practice sends audio and the confirmed Corrected Transcript to Azure only after Analyze is selected; grammar feedback uses the configured Refinement provider.
- Audio and transcript data are not stored as history.
- Temporary audio is removed after cancellation, Practice discard or replacement, normal exit, and again during the next launch after a crash.
