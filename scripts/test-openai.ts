import { resolve } from "node:path";
import "dotenv/config";
import { OpenAiClient } from "../src/main/openai-client";

const key = process.env.OPENAI_API_KEY?.trim();
if (!key) throw new Error("OPENAI_API_KEY is missing from .env");

const client = new OpenAiClient(key);
const sample = resolve("vendor/whisper.cpp/samples/jfk.wav");
const raw = await client.transcribe(sample);

console.log("Cloud Transcription:");
console.log(raw);
