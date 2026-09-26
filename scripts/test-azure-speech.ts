import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import "dotenv/config";
import { AzureSpeechClient } from "../src/main/azure-speech-client";

const key = process.env.AZURE_SPEECH_KEY?.trim();
const region = process.env.AZURE_SPEECH_REGION?.trim();
if (!key || !region) throw new Error("AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required in .env");

const client = new AzureSpeechClient(key, region);
const referenceText =
  "And so, my fellow Americans, ask not what your country can do for you; ask what you can do for your country.";
const sample = resolve("vendor/whisper.cpp/samples/jfk.wav");

const directory = await mkdtemp(join(tmpdir(), "my-whispr-azure-test-"));
const output = join(directory, "american-example.wav");
let ttsError: unknown;
let assessmentError: unknown;
try {
  console.log("Generating en-US-JennyNeural example speech…");
  try {
    await client.synthesize("Practice makes clear, confident speech easier every day.", output);
    const audio = await readFile(output);
    if (audio.byteLength < 44 || audio.subarray(0, 4).toString("ascii") !== "RIFF") {
      throw new Error("Azure TTS did not return a valid WAV file");
    }
    console.log(`Azure TTS returned a valid WAV (${audio.byteLength} bytes).`);
  } catch (error) {
    ttsError = error;
    console.error(`Azure TTS failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("Running Azure American English pronunciation assessment…");
  try {
    const assessment = await client.assess(sample, referenceText, new AbortController().signal);
    console.log(JSON.stringify(assessment, null, 2));
    if (assessment.pronunciationScore === undefined) throw new Error("Azure returned no pronunciation score");
  } catch (error) {
    assessmentError = error;
    console.error(`Azure assessment failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
if (ttsError || assessmentError) throw new Error("One or more Azure live checks failed");
