import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";

const HOST = "127.0.0.1";
const PORT = 8178;

export class WhisperServer {
  private child?: ChildProcess;
  private modelPath?: string;

  constructor(private readonly binaryPath: string) {}

  async load(modelPath: string): Promise<void> {
    await this.ensureStarted(modelPath);
  }

  async transcribe(wavPath: string, modelPath: string, signal?: AbortSignal): Promise<string> {
    await this.ensureStarted(modelPath);
    const form = new FormData();
    form.set("file", new Blob([await readFile(wavPath)], { type: "audio/wav" }), "dictation.wav");
    form.set("language", "en");
    form.set("response_format", "json");
    form.set("temperature", "0.0");

    const response = await fetch(`http://${HOST}:${PORT}/inference`, { method: "POST", body: form, signal });
    if (!response.ok) throw new Error(`Local transcription failed: HTTP ${response.status}`);
    const payload = (await response.json()) as { text?: string };
    if (!payload.text?.trim()) throw new Error("No speech detected");
    return payload.text.trim();
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.modelPath = undefined;
    if (!child || child.killed) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  private async ensureStarted(modelPath: string): Promise<void> {
    if (this.child && this.modelPath === modelPath && this.child.exitCode === null) return;
    await this.stop();
    this.modelPath = modelPath;
    this.child = spawn(this.binaryPath, ["-m", modelPath, "--host", HOST, "--port", String(PORT), "--language", "en"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout?.resume();
    this.child.stderr?.resume();
    const failure = new Promise<never>((_, reject) => {
      this.child?.once("error", reject);
      this.child?.once("exit", (code) => reject(new Error(`whisper-server exited before startup (${code ?? "signal"})`)));
    });
    await Promise.race([waitForServer(`http://${HOST}:${PORT}/`, 20_000), failure]);
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still loading the model.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out while loading the local transcription model");
}
