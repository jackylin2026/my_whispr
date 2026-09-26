import type { RefinementRequest } from "./core/refinement";

const API_ROOT = "https://api.cerebras.ai/v1";

type Fetcher = typeof fetch;

export class CerebrasClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async refine(request: RefinementRequest, signal?: AbortSignal): Promise<string> {
    const response = await this.fetcher(`${API_ROOT}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-oss-120b",
        reasoning_effort: "low",
        messages: [
          { role: "developer", content: request.instructions },
          { role: "user", content: request.input },
        ],
      }),
      signal,
    });
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(payload.error?.message || `Cerebras refinement failed: HTTP ${response.status}`);
    }
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Cerebras returned an empty refinement");
    return text;
  }
}
