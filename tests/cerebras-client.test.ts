import { describe, expect, it, vi } from "vitest";
import { CerebrasClient } from "../src/main/cerebras-client";

describe("Cerebras refinement", () => {
  it("uses gpt-oss-120b with low reasoning and keeps the transcript as user data", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "Ship Wednesday morning." } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const fetcher = fetchMock as unknown as typeof fetch;
    const client = new CerebrasClient("test-key", fetcher);

    await expect(client.refine({ instructions: "Medium instructions", input: "Tagged transcript" })).resolves.toBe("Ship Wednesday morning.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(request.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gpt-oss-120b",
      reasoning_effort: "low",
      messages: [
        { role: "developer", content: "Medium instructions" },
        { role: "user", content: "Tagged transcript" },
      ],
    });
  });

  it("surfaces Cerebras API errors", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(
      new CerebrasClient("test-key", fetcher).refine({ instructions: "Instructions", input: "Hello" }),
    ).rejects.toThrow("rate limited");
  });
});
