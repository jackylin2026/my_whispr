import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LocalModel, ModelState } from "../shared/types";
import { MODEL_CATALOG, type ModelDefinition } from "./model-catalog";

type ModelCatalog = Record<LocalModel, ModelDefinition>;
type Fetcher = typeof fetch;

interface ActiveDownload {
  listeners: Set<(progress: number) => void>;
  progress: number;
  promise: Promise<string>;
}

export class ModelManager {
  private readonly downloads = new Map<LocalModel, ActiveDownload>();

  constructor(
    private readonly directory: string,
    private readonly catalog: ModelCatalog = MODEL_CATALOG,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  pathFor(model: LocalModel): string {
    return join(this.directory, this.catalog[model].filename);
  }

  async isInstalled(model: LocalModel): Promise<boolean> {
    try {
      return (await stat(this.pathFor(model))).size === this.catalog[model].sizeBytes;
    } catch {
      return false;
    }
  }

  async states(): Promise<ModelState[]> {
    return Promise.all(
      Object.values(this.catalog).map(async (model) => ({
        id: model.id,
        label: model.label,
        sizeBytes: model.sizeBytes,
        installed: await this.isInstalled(model.id),
        downloading: this.downloads.has(model.id),
        progress: this.downloads.get(model.id)?.progress,
      })),
    );
  }

  download(model: LocalModel, onProgress: (progress: number) => void): Promise<string> {
    const active = this.downloads.get(model);
    if (active) {
      active.listeners.add(onProgress);
      onProgress(active.progress);
      return active.promise;
    }

    const download: ActiveDownload = {
      listeners: new Set([onProgress]),
      progress: 0,
      promise: Promise.resolve(""),
    };
    download.promise = this.performDownload(model, (progress) => {
      download.progress = progress;
      for (const listener of download.listeners) listener(progress);
    }).finally(() => {
      this.downloads.delete(model);
    });
    this.downloads.set(model, download);
    return download.promise;
  }

  private async performDownload(model: LocalModel, onProgress: (progress: number) => void): Promise<string> {
    const definition = this.catalog[model];
    if (await this.isInstalled(model)) return this.pathFor(model);

    const destination = this.pathFor(model);
    const temporary = `${destination}.download`;
    try {
      await mkdir(dirname(destination), { recursive: true });
      await rm(temporary, { force: true });
      const response = await this.fetcher(definition.url, { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);

      let received = 0;
      const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      body.on("data", (chunk: Buffer) => {
        received += chunk.length;
        onProgress(Math.min(1, received / definition.sizeBytes));
      });
      await pipeline(body, createWriteStream(temporary, { mode: 0o600 }));

      const digest = await sha256File(temporary);
      if (digest !== definition.sha256) {
        throw new Error(`Model checksum mismatch: expected ${definition.sha256}, received ${digest}`);
      }
      await rename(temporary, destination);
      onProgress(1);
      return destination;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async remove(model: LocalModel): Promise<void> {
    await rm(this.pathFor(model), { force: true });
  }
}

async function sha256File(path: string): Promise<string> {
  await access(path);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
