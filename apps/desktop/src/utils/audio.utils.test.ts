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
  containsSpeech,
  maxWindowLoudnessDbfs,
  NORMALIZATION_MAX_GAIN,
  NORMALIZATION_TARGET_PEAK,
  peakNormalizeForTranscription,
  SPEECH_THRESHOLD_DBFS,
  TRAILING_SILENCE_MS,
} from "./audio.utils";

const SAMPLE_RATE = 1000;

/** Constant-amplitude tone at a given loudness, since RMS == amplitude for it. */
const constantAt = (dbfs: number, sampleCount: number): Float32Array =>
  new Float32Array(sampleCount).fill(10 ** (dbfs / 20));

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

describe("maxWindowLoudnessDbfs", () => {
  it("reports the loudness of a constant clip", () => {
    expect(
      maxWindowLoudnessDbfs(constantAt(-20, 5000), SAMPLE_RATE),
    ).toBeCloseTo(-20, 1);
  });

  it("reports the loudest window, not the clip average", () => {
    // 10s of near-silence with a single loud second buried in the middle: the
    // clip average is far below the gate, the loud window is far above it.
    const samples = constantAt(-60, SAMPLE_RATE * 10);
    samples.set(constantAt(-25, SAMPLE_RATE), SAMPLE_RATE * 5);

    expect(maxWindowLoudnessDbfs(samples, SAMPLE_RATE)).toBeCloseTo(-25, 1);
    expect(containsSpeech(samples, SAMPLE_RATE)).toBe(true);
  });

  it("is not fooled by a brief transient in a room-noise clip", () => {
    // The shape of a real tap-and-release recording: a noise floor around
    // -54 dBFS with a 1ms click peaking 29dB above it. Peak loudness would
    // clear the gate; the windowed measure spreads the click's energy and
    // leaves the clip where it belongs. A transient sustained for a whole
    // window is a different matter — by energy alone it is a short word.
    const samples = constantAt(-54, SAMPLE_RATE * 2);
    samples.fill(0.05, 500, 501);

    expect(maxWindowLoudnessDbfs(samples, SAMPLE_RATE)).toBeLessThan(
      SPEECH_THRESHOLD_DBFS,
    );
    expect(containsSpeech(samples, SAMPLE_RATE)).toBe(false);
  });

  it("measures the whole clip when it is shorter than one window", () => {
    expect(maxWindowLoudnessDbfs(constantAt(-20, 50), SAMPLE_RATE)).toBeCloseTo(
      -20,
      1,
    );
  });

  it("reports negative infinity for empty and digitally silent clips", () => {
    expect(maxWindowLoudnessDbfs(new Float32Array(0), SAMPLE_RATE)).toBe(
      Number.NEGATIVE_INFINITY,
    );
    expect(maxWindowLoudnessDbfs(new Float32Array(5000), SAMPLE_RATE)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it("accepts plain number arrays", () => {
    expect(
      maxWindowLoudnessDbfs(Array.from(constantAt(-20, 5000)), SAMPLE_RATE),
    ).toBeCloseTo(-20, 1);
  });
});

describe("containsSpeech", () => {
  // Loudness bounds measured over this user's stored recordings: real dictation
  // never quieter than -31 dBFS, an accidental tap-and-release at -52 dBFS.
  it("passes clips as quiet as real dictation gets", () => {
    expect(containsSpeech(constantAt(-31, SAMPLE_RATE * 2), SAMPLE_RATE)).toBe(
      true,
    );
  });

  it("rejects a room-noise tap", () => {
    expect(containsSpeech(constantAt(-52, SAMPLE_RATE * 2), SAMPLE_RATE)).toBe(
      false,
    );
  });

  it("rejects digital silence of any length", () => {
    expect(
      containsSpeech(new Float32Array(SAMPLE_RATE * 23), SAMPLE_RATE),
    ).toBe(false);
  });
});
