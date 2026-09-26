import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefinementPromptStore } from "../src/main/refinement-prompt-store";

const defaults = { light: "Default light", medium: "Default medium" } as const;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<{ directory: string; store: RefinementPromptStore }> {
  const directory = await mkdtemp(join(tmpdir(), "my-whispr-prompts-"));
  directories.push(directory);
  return { directory, store: new RefinementPromptStore(directory, defaults) };
}

describe("Refinement prompt store", () => {
  it("reloads an edited prompt for every request", async () => {
    const { directory, store } = await fixture();
    const path = join(directory, "light_refine_prompt.md");
    await writeFile(path, "First prompt");
    expect((await store.build("light", "Raw")).request.instructions).toBe("First prompt");
    await writeFile(path, "Second prompt");
    expect((await store.build("light", "Raw")).request.instructions).toBe("Second prompt");
  });

  it("uses the built-in default for missing, empty, or oversized files", async () => {
    const { directory, store } = await fixture();
    const path = join(directory, "medium_refine_prompt.md");
    expect(await store.build("medium", "Raw")).toMatchObject({ source: "fallback", warning: expect.any(String) });
    await writeFile(path, "   ");
    expect((await store.build("medium", "Raw")).request.instructions).toBe("Default medium");
    await writeFile(path, "x".repeat(64 * 1024 + 1));
    expect((await store.build("medium", "Raw")).source).toBe("fallback");
    await rm(path);
    await mkdir(path);
    expect((await store.build("medium", "Raw")).source).toBe("fallback");
  });

  it("creates a missing file and resets edits to the shipped default", async () => {
    const { directory, store } = await fixture();
    const path = await store.ensureFile("light");
    expect(await readFile(path, "utf8")).toBe("Default light\n");
    await writeFile(path, "Customized");
    await store.reset("light");
    expect(await readFile(path, "utf8")).toBe("Default light\n");
  });
});
