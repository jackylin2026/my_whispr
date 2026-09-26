import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { RefinementRequest } from "./core/refinement";

const API_ROOT = "https://api.openai.com/v1";
type Fetcher = typeof fetch;

export class OpenAiClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async transcribe(wavPath: string, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.set("model", "gpt-4o-mini-transcribe");
    form.set("language", "en");
    form.set("file", new Blob([await readFile(wavPath)], { type: "audio/wav" }), basename(wavPath));

    const response = await this.fetcher(`${API_ROOT}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal,
    });
    const payload = (await response.json()) as { text?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `OpenAI transcription failed: HTTP ${response.status}`);
    if (!payload.text?.trim()) throw new Error("No speech detected");
    return payload.text.trim();
  }

  async refine(request: RefinementRequest, signal?: AbortSignal): Promise<string> {
    const response = await this.fetcher(`${API_ROOT}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        instructions: request.instructions,
        input: request.input,
      }),
      signal,
    });
    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(payload.error?.message || `OpenAI refinement failed: HTTP ${response.status}`);
    const text =
      payload.output_text ??
      payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!text?.trim()) throw new Error("OpenAI returned an empty refinement");
    return text.trim();
  }
}
