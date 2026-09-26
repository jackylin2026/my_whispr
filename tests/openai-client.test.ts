import { describe, expect, it, vi } from "vitest";
import { OpenAiClient } from "../src/main/openai-client";

describe("OpenAI Refinement", () => {
  it("uses the Responses API with conservative refinement instructions", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: "Ship Wednesday morning." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new OpenAiClient("test-key", fetchMock as unknown as typeof fetch);

    await expect(client.refine({ instructions: "Light instructions", input: "Tagged transcript" })).resolves.toBe("Ship Wednesday morning.");
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gpt-4o-mini",
      instructions: "Light instructions",
      input: "Tagged transcript",
    });
  });
});
