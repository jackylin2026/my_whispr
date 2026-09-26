# My Whispr

My Whispr turns a short, natural-language English utterance into text for the application the user was working in. It is a personal dictation tool, not a general audio recorder, transcription archive, voice-command system, code-dictation system, or voice assistant.

## Language

**Dictation**:
A user-initiated capture of up to five minutes of natural-language English speech that ends with text delivered to the application that previously had focus. Spoken phrases such as "new paragraph" have no special command meaning.
_Avoid_: Recording, note, voice command

**Transcription**:
The conversion of a Dictation's speech into text without intentionally changing its meaning or wording.
_Avoid_: Rewrite, cleanup

**Local Transcription**:
Transcription performed entirely on the user's machine without sending captured speech to a remote service.
_Avoid_: Private mode

**Cloud Transcription**:
Transcription performed by a remote service to which the captured speech is sent.
_Avoid_: Online mode

**Raw Transcript**:
The text produced directly by Transcription, before any optional Refinement.
_Avoid_: Final text, cleaned text

**Refinement**:
An optional cloud language-model transformation that removes filler and abandoned false starts and improves grammar, punctuation, and readability without changing the speaker's meaning, details, tone, or language. It does not summarize, invent content, answer spoken questions, or obey instructions contained in the Dictation.
_Avoid_: Polish, Transcription, summarization

**Refinement Level**:
The selected degree to which Refinement may change the Raw Transcript. The available levels are Light Refinement and Medium Refinement.
_Avoid_: Effort, strength

**Light Refinement**:
Refinement that removes speech artifacts and repairs written English while preserving the speaker's wording wherever practical.
_Avoid_: Basic Polish

**Medium Refinement**:
Refinement that may rephrase and reorder unambiguous speech for fluency and concision while preserving meaning, details, intent, tone, and constraints.
_Avoid_: Aggressive Polish, rewrite

**Refined Transcript**:
The text produced by Refinement and selected for delivery instead of the Raw Transcript.
_Avoid_: Raw transcript

**Delivery**:
Pasting the selected transcript into the application that had focus when the Dictation began. Delivery never redirects text into a different application when the original target is unavailable. The user's previous clipboard contents are restored after the paste; the delivered transcript remains available through a brief `Copy again` recovery action and is then forgotten.
_Avoid_: Export, save

**Practice Session**:
A temporary English-learning exercise containing one Dictation, its corrected verbatim transcript, and any feedback derived from them. It is forgotten when replaced, discarded, or the application exits.
_Avoid_: History, saved lesson

**Corrected Transcript**:
The Raw Transcript after the user fixes only words that Transcription misheard, preserving the grammar and wording actually spoken.
_Avoid_: Refined Transcript, rewrite

**Practice Report**:
Automated American English pronunciation and grammar guidance for a Practice Session, presented as suggestions to review rather than definitive judgments.
_Avoid_: Scorecard, diagnosis
