import "dotenv/config";
import lightPromptDefault from "../light_refine_prompt.md?raw";
import mediumPromptDefault from "../medium_refine_prompt.md?raw";
import { CerebrasClient } from "../src/main/cerebras-client";
import { assessRefinement } from "../src/main/core/refinement";
import { RefinementPromptStore } from "../src/main/refinement-prompt-store";

const key = process.env.CEREBRAS_API_KEY?.trim();
if (!key) throw new Error("CEREBRAS_API_KEY is missing from .env");

const raw = "So, um, I think we should ship the release on Tuesday, no, actually Wednesday morning.";
const prompts = new RefinementPromptStore(process.cwd(), {
  light: lightPromptDefault,
  medium: mediumPromptDefault,
});
const { request } = await prompts.build("light", raw);
const candidate = await new CerebrasClient(key).refine(request);
const assessment = assessRefinement(raw, candidate);
if (!assessment.accepted) throw new Error(`The Cerebras response failed Refinement safety checks: ${assessment.reason}`);

console.log("Raw Transcript:");
console.log(raw);
console.log("\nCerebras Refinement:");
console.log(assessment.text);
