import { access, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PracticePromptKind } from "../shared/types";

const FILES: Record<PracticePromptKind, string> = {
  grammar: "practice_grammar_prompt.md",
  pronunciation: "practice_pronunciation_prompt.md",
};

export class PracticePromptStore {
  constructor(private readonly directory: string, private readonly defaults: Record<PracticePromptKind, string>) {}

  pathFor(kind: PracticePromptKind): string { return join(this.directory, FILES[kind]); }

  async load(kind: PracticePromptKind): Promise<string> {
    try { return (await readFile(this.pathFor(kind), "utf8")).trim() || this.defaults[kind].trim(); }
    catch { return this.defaults[kind].trim(); }
  }

  async ensureFile(kind: PracticePromptKind): Promise<string> {
    const path = this.pathFor(kind);
    try { await access(path); } catch { await this.reset(kind); }
    return path;
  }

  async reset(kind: PracticePromptKind): Promise<void> {
    const path = this.pathFor(kind);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${this.defaults[kind].trim()}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }
}
