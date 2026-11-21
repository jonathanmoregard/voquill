import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../store", () => ({ getAppState: vi.fn(() => ({})) }));
vi.mock("./env.utils", () => ({
  isLinux: () => true,
  isMacOS: () => false,
  isWindows11: () => false,
}));
vi.mock("./user.utils", () => ({ getMyUser: () => null }));

import {
  appendTrailingSilence,
  assessSpeech,
  hasNoSignal,
  measureSpeech,
  NORMALIZATION_MAX_GAIN,
  NORMALIZATION_TARGET_PEAK,
  peakNormalizeForTranscription,
  resampleAudio,
  TRAILING_SILENCE_MS,
  VAD_MIN_SPEECH_FRAMES,
  VAD_SAMPLE_RATE,
  VAD_SPEECH_PROBABILITY,
} from "./audio.utils";

const SAMPLE_RATE = 1000;

const sine = (amplitude: number, sampleRate: number, seconds: number) =>
  Float32Array.from(
    { length: sampleRate * seconds },
    (_, index) =>
      amplitude * Math.sin((2 * Math.PI * 220 * index) / sampleRate),
  );

describe("appendTrailingSilence", () => {
  it("appends the configured amount of silence", () => {
    const samples = new Float32Array([0.5, -0.5, 0.25]);
    const padded = appendTrailingSilence(samples, SAMPLE_RATE);
    const expectedPad = Math.round((SAMPLE_RATE * TRAILING_SILENCE_MS) / 1000);
    expect(padded.length).toBe(samples.length + expectedPad);
  });

  it("preserves the original samples and pads with zeros", () => {
    const samples = new Float32Array([0.5, -0.5, 0.25]);
    const padded = appendTrailingSilence(samples, SAMPLE_RATE, 100);
    expect(Array.from(padded.slice(0, 3))).toEqual([0.5, -0.5, 0.25]);
    expect(Array.from(padded.slice(3)).every((value) => value === 0)).toBe(
      true,
    );
    expect(padded.length).toBe(3 + 100);
  });

  it("returns empty clips unchanged", () => {
    const empty = new Float32Array(0);
    expect(appendTrailingSilence(empty, SAMPLE_RATE).length).toBe(0);
  });
});

describe("peakNormalizeForTranscription", () => {
  it("boosts quiet speech even when a loud chime bleeds into the leading window", () => {
    // 600ms of loud chime bleed at 0.9, then quiet speech at 0.07.
    const samples = new Float32Array(1000);
    samples.fill(0.9, 0, 600);
    samples.fill(0.07, 600);

    const normalized = peakNormalizeForTranscription(samples, SAMPLE_RATE);

    // Gain should be set by the post-chime peak (0.07), clamped to max gain.
    const expectedGain = Math.min(
      NORMALIZATION_TARGET_PEAK / 0.07,
      NORMALIZATION_MAX_GAIN,
    );
    expect(normalized[700]).toBeCloseTo(0.07 * expectedGain, 5);
    // The chime region is scaled by the same gain but clamped to 1.
    expect(normalized[100]).toBe(1);
  });

  it("clamps gain to the configured maximum for very quiet clips", () => {
    const samples = new Float32Array(1000).fill(0.01);
    const normalized = peakNormalizeForTranscription(samples, SAMPLE_RATE);
    expect(normalized[800]).toBeCloseTo(0.01 * NORMALIZATION_MAX_GAIN, 5);
  });

  it("leaves digital silence untouched", () => {
    const samples = new Float32Array(1000);
    const normalized = peakNormalizeForTranscription(samples, SAMPLE_RATE);
    expect(Array.from(normalized).every((value) => value === 0)).toBe(true);
  });

  it("measures the whole clip when it is shorter than the excluded window", () => {
    const samples = new Float32Array(200).fill(0.2);
    const normalized = peakNormalizeForTranscription(samples, SAMPLE_RATE);
    expect(normalized[50]).toBeCloseTo(NORMALIZATION_TARGET_PEAK, 3);
  });

  it("attenuates clips that already peak above the target", () => {
    const samples = new Float32Array(1000).fill(1);
    const normalized = peakNormalizeForTranscription(samples, SAMPLE_RATE);
    expect(normalized[800]).toBeCloseTo(NORMALIZATION_TARGET_PEAK, 5);
  });
});

describe("hasNoSignal", () => {
  it("reports no signal when every sample is exactly zero", () => {
    expect(hasNoSignal(Array.from({ length: 16_000 }, () => 0))).toBe(true);
  });

  it("reports no signal for an empty clip", () => {
    expect(hasNoSignal([])).toBe(true);
  });

  it("does not report no signal when a single sample is non-zero", () => {
    const samples = Array.from({ length: 16_000 }, () => 0);
    samples[9_999] = 1 / 32_768;
    expect(hasNoSignal(samples)).toBe(false);
  });
});

describe("resampleAudio", () => {
  it("returns the input untouched when the rates match", () => {
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleAudio(samples, 16_000, 16_000)).toBe(samples);
  });

  it("downsamples to the output rate's length", () => {
    const samples = new Float32Array(48_000);
    expect(resampleAudio(samples, 48_000, 16_000).length).toBe(16_000);
  });

  it("interpolates between neighbouring samples when upsampling", () => {
    const samples = new Float32Array([0, 1, 0]);
    expect(Array.from(resampleAudio(samples, 1, 2))).toEqual([
      0, 0.5, 1, 0.5, 0, 0,
    ]);
  });
});

describe("assessSpeech", () => {
  const framesAt = (probability: number, count: number) =>
    Array.from({ length: count }, () => probability);

  it("finds speech when enough frames reach the speech probability", () => {
    const probabilities = [
      ...framesAt(0.01, 20),
      ...framesAt(VAD_SPEECH_PROBABILITY, VAD_MIN_SPEECH_FRAMES),
    ];
    expect(assessSpeech(probabilities).containsSpeech).toBe(true);
  });

  it("finds no speech when one frame too few reach the speech probability", () => {
    const probabilities = [
      ...framesAt(0.01, 20),
      ...framesAt(0.9, VAD_MIN_SPEECH_FRAMES - 1),
    ];
    expect(assessSpeech(probabilities).containsSpeech).toBe(false);
  });

  it("does not count frames just below the speech probability", () => {
    const probabilities = framesAt(VAD_SPEECH_PROBABILITY - 0.01, 50);
    expect(assessSpeech(probabilities).speechFrames).toBe(0);
  });

  it("counts speech frames that are not consecutive", () => {
    const probabilities = [0.9, 0.01, 0.9, 0.01, 0.9];
    expect(assessSpeech(probabilities)).toEqual({
      speechFrames: 3,
      maxProbability: 0.9,
      containsSpeech: true,
    });
  });

  it("finds no speech in a clip too short to yield any frame", () => {
    expect(assessSpeech([])).toEqual({
      speechFrames: 0,
      maxProbability: 0,
      containsSpeech: false,
    });
  });
});

describe("measureSpeech", () => {
  it("runs the VAD on the clip resampled to the VAD rate at its recorded level", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const samples = sine(0.01, 48_000, 1);

    await measureSpeech(samples, 48_000);

    expect(invoke).toHaveBeenCalledWith("detect_speech_probabilities", {
      samples: Array.from(resampleAudio(samples, 48_000, VAD_SAMPLE_RATE)),
    });
  });

  it("accepts plain number arrays", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const samples = Array.from(sine(0.01, 16_000, 1));

    await measureSpeech(samples, 16_000);

    expect(invoke).toHaveBeenCalledWith("detect_speech_probabilities", {
      samples,
    });
  });

  it("assesses the probabilities the VAD returns", async () => {
    const probabilities = [0.01, 0.8, 0.9, 0.95, 0.02];
    vi.mocked(invoke).mockResolvedValueOnce(probabilities);

    await expect(measureSpeech(sine(0.01, 16_000, 1), 16_000)).resolves.toEqual(
      assessSpeech(probabilities),
    );
  });

  it("rejects when the VAD fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("VAD model missing");

    await expect(measureSpeech(sine(0.01, 16_000, 1), 16_000)).rejects.toBe(
      "VAD model missing",
    );
  });
});
