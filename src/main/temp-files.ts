import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export class TempFiles {
  constructor(private readonly root: string) {}

  async purge(): Promise<void> {
    const parent = dirname(this.root);
    const prefix = `${basename(this.root)}-`;
    for (const entry of await readdir(parent, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && entry.name.startsWith(prefix)) {
        await rm(join(parent, entry.name), { recursive: true, force: true });
      }
    }
  }

  async createWav(bytes: Uint8Array): Promise<{ path: string; dispose: () => Promise<void> }> {
    const directory = await mkdtemp(`${this.root}-`);
    const path = join(directory, "dictation.wav");
    await writeFile(path, bytes, { mode: 0o600 });
    return { path, dispose: () => rm(directory, { recursive: true, force: true }) };
  }
}
