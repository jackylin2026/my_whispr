# My Whispr

My Whispr is a focused personal dictation and English-practice app for Ubuntu GNOME on X11. Press a global hot key, speak naturally, and press it again: My Whispr transcribes the audio and pastes the text into the application where the Dictation began.

The default workflow runs Transcription locally with Refinement off, so it does not require an API key or send the Dictation to a cloud service.

> [!IMPORTANT]
> The current version targets Ubuntu GNOME on **X11**. Wayland is not supported because My Whispr uses `xdotool` and `xprop` to return focus and paste into the original application.

## Features

- Start and stop Dictation from any application with a configurable global hot key (`F8` by default).
- Transcribe English locally with `whisper.cpp`, or use OpenAI or Azure Speech.
- Optionally apply Light or Medium Refinement with OpenAI or Cerebras.
- Paste automatically with `Ctrl+V` or terminal-friendly `Ctrl+Shift+V`, then restore the previous clipboard contents.
- Recover the latest delivered text for five seconds with **Copy again**.
- Cancel active work globally with `Escape`; Dictations also stop automatically after five minutes.
- Manage local English models from Settings:
  - `base.en`: faster, approximately 142 MiB
  - `small.en`: more accurate, approximately 466 MiB
- Turn the latest successful Dictation into a temporary English Practice Session with transcript comparison, grammar guidance, American English pronunciation feedback, and example audio.
- Edit and reset the Markdown prompts used for Refinement and Practice coaching.

My Whispr intentionally has no transcript history, meeting recorder, notes system, voice assistant, code-dictation language, telemetry, or account system.

## Beginner quick start

### 1. Check that you are using X11

Open a terminal and run:

```bash
echo "$XDG_SESSION_TYPE"
```

The result must be `x11`. If it says `wayland`, sign out, select **Ubuntu on Xorg** from the login-screen session menu, and sign in again.

### 2. Install the system tools

Install Node.js and npm, then install the Ubuntu packages needed to build the local engine and deliver text:

```bash
sudo apt update
sudo apt install build-essential cmake git xdotool x11-utils
```

You also need a working default microphone.

### 3. Install and start My Whispr

From this repository's directory, run:

```bash
npm install
npm run setup:whisper
cp .env.example .env
npm run dev
```

`setup:whisper` downloads the pinned `whisper.cpp` source and compiles its server. No API keys need to be added to `.env` for the default local workflow.

### 4. Make your first Dictation

1. Place the text cursor in an application such as a text editor.
2. Press `F8` and speak in English. The tray microphone turns red while My Whispr listens.
3. Press `F8` again. The first local Dictation downloads and verifies the selected model, so it takes longer than later Dictations.
4. Wait for the transcript to be pasted back into the original application.

Click the tray microphone to open Settings. The tray menu also lets you start or stop a Dictation, copy the most recently delivered text during its five-second recovery period, or quit the app.

## Configure Transcription and Refinement

The app starts with **Local Whisper.cpp**, the `base.en` model, and Refinement set to **Off**. Settings are stored in Electron's per-user application-data directory.

| Function | Provider | Required configuration | Data sent |
| --- | --- | --- | --- |
| Local Transcription | `whisper.cpp` | Run `npm run setup:whisper` | Nothing |
| Cloud Transcription | OpenAI | `OPENAI_API_KEY` | Dictation audio |
| Cloud Transcription | Azure Speech | `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` | Dictation audio |
| Refinement | OpenAI | `OPENAI_API_KEY` | Raw Transcript |
| Refinement | Cerebras | `CEREBRAS_API_KEY` | Raw Transcript |
| Practice pronunciation and audio | Azure Speech | Azure key and region | Audio and Corrected Transcript |
| Practice grammar coaching | Selected Refinement provider | OpenAI or Cerebras key | Corrected Transcript |

Add only the credentials for the providers you want to use to `.env`, then restart the app. Missing credentials disable the corresponding Settings choices.

For Azure Speech, either edit `.env` directly or use the interactive setup guide:

```bash
npm run setup:azure-speech
```

Then restart My Whispr and select the provider under **Settings → Transcription** or **Settings → Refinement**.

Refinement has two levels:

- **Light** removes speech artifacts and repairs grammar while preserving the speaker's wording wherever practical.
- **Medium** may rephrase and reorder unambiguous speech for more fluent, concise writing.

If Refinement fails or produces an unsafe result, My Whispr keeps and delivers the Raw Transcript with a warning. The active Refinement and Practice prompts can be opened or restored under **Settings → Prompt**; edits apply to the next Dictation or Practice analysis.

## English Practice quick guide

Practice uses the latest successful Dictation; it does not make or retain a history.

1. Make a normal Dictation with `F8`.
2. In the application that received the text, correct **only words that Transcription misheard**. Keep the grammar and wording you actually spoke.
3. Select the entire corrected passage.
4. Press `Shift+F8` to capture the selection and open **Settings → Practice**.
5. Review the Raw Transcript and Corrected Transcript, make any final correction, and select **Analyze**.

In GNOME Terminal or tmux, hold `Shift` while dragging to ensure the terminal owns the selection.

With Azure Speech configured, the Practice Report can include pronunciation, fluency, and prosody scores; words to review; playback of your audio; and American English example audio. Grammar feedback uses the selected Refinement provider and can work without Azure. Feedback is guidance to review, not a definitive assessment.

The Practice Session is deleted when you discard it, replace it with a newer Dictation, or quit My Whispr.

## Hot keys and Delivery

The defaults are:

| Action | Hot key |
| --- | --- |
| Start or stop Dictation | `F8` |
| Open Practice with selected corrected text | `Shift+F8` |
| Cancel active work | `Escape` |

Change these under **Settings → Hot keys**. My Whispr tests a new binding before releasing the current one. If the shortcut is invalid, unavailable, already used by another My Whispr action, or owned by another application, the existing binding remains active and Settings shows an error.

Automatic Delivery sends `Ctrl+Shift+V` to detected terminal windows and `Ctrl+V` elsewhere. If automatic detection does not work for an application, choose a fixed paste shortcut under **Settings → Hot keys → Paste shortcut**.

My Whispr restores the previous clipboard only when the clipboard still contains the text it placed there. If the original target window is unavailable, it does not redirect the transcript into a different application; use the five-second **Copy again** tray action instead.

## Privacy and temporary data

- Local Transcription with Refinement off makes no cloud-processing request.
- OpenAI or Azure Cloud Transcription sends Dictation audio to the selected provider.
- Refinement sends the Raw Transcript to OpenAI or Cerebras, even when Transcription is local.
- Practice sends audio and the confirmed Corrected Transcript to Azure only after **Analyze** is selected. Grammar feedback sends the Corrected Transcript to the selected Refinement provider.
- Audio and transcripts are not stored as history.
- Temporary audio is removed after cancellation, Practice discard or replacement, normal exit, and again on the next launch after a crash.

## Development

Run the local quality checks with:

```bash
npm run check
```

This runs TypeScript checking, the test suite, and the production build. The commands can also be run separately:

```bash
npm run typecheck
npm test
npm run build
```

Optional live provider checks make real API requests and require the corresponding credentials in `.env`:

```bash
npm run test:openai
npm run test:cerebras
npm run test:azure
npm run eval:refinement -- --provider=both
```

Use `openai` or `cerebras` instead of `both` to evaluate one Refinement provider. Live provider checks are not included in `npm run check`.

## Architecture

- Electron main process: lifecycle, global hot keys, Dictation state machine, model downloads, Transcription, Refinement, clipboard, and X11 Delivery
- Sandboxed preload: narrow typed IPC API
- React renderer: hidden microphone capture and Settings
- `whisper.cpp` sidecar: persistent CPU-based Local Transcription
- OpenAI: optional Cloud Transcription and optional Refinement with `gpt-4o-mini`
- Cerebras: optional low-latency Refinement with `gpt-oss-120b`
- Azure Speech: optional Cloud Transcription, American English pronunciation assessment, and `en-US-JennyNeural` example speech

See [CONTEXT.md](./CONTEXT.md) for canonical domain language and [docs/adr](./docs/adr/) for architectural decisions.
