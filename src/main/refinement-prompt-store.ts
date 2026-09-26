import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RefinementLevel } from "../shared/types";
import { type RefinementRequest, wrapRefinementTranscript } from "./core/refinement";

const MAX_PROMPT_BYTES = 64 * 1024;

const PROMPT_FILES: Record<RefinementLevel, string> = {
  light: "light_refine_prompt.md",
  medium: "medium_refine_prompt.md",
};

export interface LoadedRefinementRequest {
  request: RefinementRequest;
  source: "file" | "fallback";
  warning?: string;
}

export class RefinementPromptStore {
  constructor(
    private readonly directory: string,
    private readonly defaults: Record<RefinementLevel, string>,
  ) {}

  async build(level: RefinementLevel, transcript: string): Promise<LoadedRefinementRequest> {
    const loaded = await this.load(level);
    return {
      request: {
        instructions: loaded.instructions,
        input: wrapRefinementTranscript(transcript),
      },
      source: loaded.source,
      warning: loaded.warning,
    };
  }

  pathFor(level: RefinementLevel): string {
    return join(this.directory, PROMPT_FILES[level]);
  }

  async ensureFile(level: RefinementLevel): Promise<string> {
    const path = this.pathFor(level);
    try {
      await access(path);
    } catch {
      await this.reset(level);
    }
    return path;
  }

  async reset(level: RefinementLevel): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(level);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${this.defaults[level].trim()}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }

  private async load(level: RefinementLevel): Promise<{
    instructions: string;
    source: "file" | "fallback";
    warning?: string;
  }> {
    const filename = PROMPT_FILES[level];
    try {
      const instructions = (await readFile(this.pathFor(level), "utf8")).trim();
      if (!instructions) return this.fallback(level, `${filename} is empty`);
      if (Buffer.byteLength(instructions, "utf8") > MAX_PROMPT_BYTES) {
        return this.fallback(level, `${filename} is larger than 64 KiB`);
      }
      return { instructions, source: "file" };
    } catch {
      return this.fallback(level, `${filename} could not be read`);
    }
  }

  private fallback(level: RefinementLevel, reason: string): {
    instructions: string;
    source: "fallback";
    warning: string;
  } {
    return {
      instructions: this.defaults[level].trim(),
      source: "fallback",
      warning: `${reason}; the built-in ${level === "light" ? "Light" : "Medium"} prompt was used.`,
    };
  }
}
