import { describe, expect, it } from "vitest";
import { encodeWav, resample, rootMeanSquare } from "../src/renderer/src/audio-capture";

describe("audio capture helpers", () => {
  it("resamples 48 kHz input to 16 kHz", () => {
    const input = new Float32Array(48_000).fill(0.25);
    const output = resample(input, 48_000, 16_000);
    expect(output).toHaveLength(16_000);
    expect(output[8_000]).toBeCloseTo(0.25);
  });

  it("writes mono 16-bit PCM WAV", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 16_000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(wav.byteLength).toBe(50);
  });

  it("detects silence", () => {
    expect(rootMeanSquare(new Float32Array(100))).toBe(0);
    expect(rootMeanSquare(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });
});
