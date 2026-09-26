import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelDefinition } from "../src/main/model-catalog";
import { ModelManager } from "../src/main/model-manager";
import type { LocalModel } from "../src/shared/types";

describe("model downloads", () => {
  it("coalesces concurrent requests for the same model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "my-whispr-model-test-"));
    const bytes = new TextEncoder().encode("tiny model fixture");
    const definition: ModelDefinition = {
      id: "small.en",
      label: "Small English",
      filename: "small.bin",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url: "https://example.invalid/small.bin",
    };
    const catalog = {
      "base.en": { ...definition, id: "base.en" as LocalModel, filename: "base.bin" },
      "small.en": definition,
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async () => {
      await gate;
      return new Response(bytes);
    }) as unknown as typeof fetch;
    const manager = new ModelManager(directory, catalog, fetcher);

    const first = manager.download("small.en", () => undefined);
    const second = manager.download("small.en", () => undefined);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      join(directory, "small.bin"),
      join(directory, "small.bin"),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await rm(directory, { recursive: true, force: true });
  });
});
