export class AudioCapture {
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;
  private sink?: GainNode;
  private chunks: Float32Array[] = [];
  private sampleRate = 48_000;

  async start(onStage?: (stage: string, elapsedMs: number) => void): Promise<void> {
    const startedAt = performance.now();
    await this.cancel();
    onStage?.("cleanup", performance.now() - startedAt);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    onStage?.("microphone acquired", performance.now() - startedAt);
    this.context = new AudioContext();
    this.sampleRate = this.context.sampleRate;
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.chunks = [];
    this.processor.onaudioprocess = (event) => {
      this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.sink);
    this.sink.connect(this.context.destination);
    onStage?.("audio graph ready", performance.now() - startedAt);
  }

  async stop(): Promise<Uint8Array> {
    if (!this.context || !this.stream) throw new Error("Microphone capture is not active");
    const samples = mergeChunks(this.chunks);
    const sampleRate = this.sampleRate;
    await this.release();
    if (rootMeanSquare(samples) < 0.003) throw new Error("No speech detected");
    return encodeWav(resample(samples, sampleRate, 16_000), 16_000);
  }

  async cancel(): Promise<void> {
    await this.release();
    this.chunks = [];
  }

  private async release(): Promise<void> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.processor = undefined;
    this.source = undefined;
    this.sink = undefined;
    this.stream = undefined;
    this.context = undefined;
  }
}

export function mergeChunks(chunks: Float32Array[]): Float32Array {
  const result = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function resample(samples: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return samples;
  const outputLength = Math.round((samples.length * outputRate) / inputRate);
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    output[index] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return output;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
