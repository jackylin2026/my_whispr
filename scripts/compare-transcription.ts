import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import "dotenv/config";
import { AzureSpeechClient } from "../src/main/azure-speech-client";
import { ModelManager } from "../src/main/model-manager";
import { SettingsStore } from "../src/main/settings-store";
import { WhisperServer } from "../src/main/whisper-server";

const audioPath = resolve(process.argv[2] ?? "user_test/user_voice.wav");
const referencePath = resolve(process.argv[3] ?? "user_test/corrected_transcript.txt");
const reference = (await readFile(referencePath, "utf8")).trim();
const key = process.env.AZURE_SPEECH_KEY?.trim();
const region = process.env.AZURE_SPEECH_REGION?.trim();
if (!key || !region) throw new Error("Azure Speech is not configured");

const configRoot = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
const userData = join(configRoot, "My Whispr");
const settings = await new SettingsStore(join(userData, "settings.json")).load();
const models = new ModelManager(join(userData, "models"));
const whisper = new WhisperServer(resolve("vendor/whisper.cpp/build/bin/whisper-server"));
let local = "";
try {
  local = await whisper.transcribe(
    audioPath,
    models.pathFor(settings.localModel),
    new AbortController().signal,
  );
} finally {
  await whisper.stop();
}
const azure = await new AzureSpeechClient(key, region).transcribe(audioPath, new AbortController().signal);

console.log("REFERENCE:\n" + reference);
report(`LOCAL WHISPER.CPP ${settings.localModel}`, local, reference);
report("AZURE STT en-US", azure, reference);

function report(label: string, hypothesis: string, expected: string): void {
  const comparison = compare(expected, hypothesis);
  console.log(`\n${label}:\n${hypothesis}`);
  console.log(`WER: ${(comparison.errors / comparison.referenceWords * 100).toFixed(1)}% (${comparison.errors}/${comparison.referenceWords})`);
  if (comparison.operations.length) {
    console.log("Differences:");
    for (const operation of comparison.operations) console.log(`  ${operation}`);
  }
}

function compare(expected: string, actual: string): { errors: number; referenceWords: number; operations: string[] } {
  const left = tokenize(expected);
  const right = tokenize(actual);
  const cost = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) cost[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) cost[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      cost[i][j] = Math.min(
        cost[i - 1][j] + 1,
        cost[i][j - 1] + 1,
        cost[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
  }
  const operations: string[] = [];
  let i = left.length;
  let j = right.length;
  while (i || j) {
    if (i && j && left[i - 1] === right[j - 1] && cost[i][j] === cost[i - 1][j - 1]) { i -= 1; j -= 1; continue; }
    if (i && j && cost[i][j] === cost[i - 1][j - 1] + 1) {
      operations.unshift(`substitute “${left[i - 1]}” → “${right[j - 1]}”`); i -= 1; j -= 1;
    } else if (i && cost[i][j] === cost[i - 1][j] + 1) {
      operations.unshift(`delete “${left[i - 1]}”`); i -= 1;
    } else {
      operations.unshift(`insert “${right[j - 1]}”`); j -= 1;
    }
  }
  return { errors: cost[left.length][right.length], referenceWords: left.length, operations };
}

function tokenize(value: string): string[] {
  return value.toLowerCase().replace(/[’]/g, "'").match(/[a-z]+(?:'[a-z]+)?|\d+(?:[.:/-]\d+)*/g) ?? [];
}
