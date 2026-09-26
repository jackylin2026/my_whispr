import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { TempFiles } from "../src/main/temp-files";

describe("temporary audio", () => {
  it("purges stale application-owned dictation directories", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "my-whispr-test-"));
    const root = join(sandbox, "my-whispr-dictation");
    const files = new TempFiles(root);
    const pending = await files.createWav(new Uint8Array([82, 73, 70, 70]));

    expect((await readdir(sandbox)).some((entry) => entry.startsWith("my-whispr-dictation-"))).toBe(true);
    await files.purge();
    expect(await readdir(sandbox)).toEqual([]);

    await pending.dispose();
    await rm(join(tmpdir(), basename(sandbox)), { recursive: true, force: true });
  });
});
