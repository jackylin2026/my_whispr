import { readFile } from "node:fs/promises";
import "dotenv/config";
import lightPromptDefault from "../light_refine_prompt.md?raw";
import mediumPromptDefault from "../medium_refine_prompt.md?raw";
import { CerebrasClient } from "../src/main/cerebras-client";
import { assessRefinement } from "../src/main/core/refinement";
import { OpenAiClient } from "../src/main/openai-client";
import { RefinementPromptStore } from "../src/main/refinement-prompt-store";
import type { RefinementLevel } from "../src/shared/types";

interface Fixture {
  id: string;
  raw: string;
  focus: string;
}

const requested = process.argv.find((argument) => argument.startsWith("--provider="))?.split("=")[1] ?? "both";
if (!new Set(["openai", "cerebras", "both"]).has(requested)) {
  throw new Error("Use --provider=openai, --provider=cerebras, or --provider=both");
}

const openAiKey = process.env.OPENAI_API_KEY?.trim();
const cerebrasKey = process.env.CEREBRAS_API_KEY?.trim();
const providers = [
  ...((requested === "openai" || requested === "both") && openAiKey
    ? [{ name: "openai", refine: (request: Parameters<OpenAiClient["refine"]>[0]) => new OpenAiClient(openAiKey).refine(request) }]
    : []),
  ...((requested === "cerebras" || requested === "both") && cerebrasKey
    ? [{ name: "cerebras", refine: (request: Parameters<CerebrasClient["refine"]>[0]) => new CerebrasClient(cerebrasKey).refine(request) }]
    : []),
];
if (!providers.length) throw new Error("No API key is configured for the requested provider selection");

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/refinement-eval.json", import.meta.url), "utf8"),
) as Fixture[];
const prompts = new RefinementPromptStore(process.cwd(), {
  light: lightPromptDefault,
  medium: mediumPromptDefault,
});

for (const provider of providers) {
  for (const level of ["light", "medium"] satisfies RefinementLevel[]) {
    for (const fixture of fixtures) {
      const loaded = await prompts.build(level, fixture.raw);
      try {
        const candidate = await provider.refine(loaded.request);
        const assessment = assessRefinement(fixture.raw, candidate);
        console.log(JSON.stringify({
          provider: provider.name,
          level,
          promptSource: loaded.source,
          id: fixture.id,
          focus: fixture.focus,
          raw: fixture.raw,
          candidate,
          assessment,
        }));
      } catch (error) {
        console.log(JSON.stringify({
          provider: provider.name,
          level,
          promptSource: loaded.source,
          id: fixture.id,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }
}
