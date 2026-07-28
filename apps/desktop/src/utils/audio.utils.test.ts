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
  NORMALIZATION_MAX_GAIN,
  NORMALIZATION_TARGET_PEAK,
  peakNormalizeForTranscription,
  TRAILING_SILENCE_MS,
} from "./audio.utils";

const SAMPLE_RATE = 1000;

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
