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
  dynamicRangeDb,
  hasNoSignal,
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

/** Rescales a clip, as changing the microphone's input gain would. */
const atGain = (samples: Float32Array, gain: number): Float32Array =>
  samples.map((sample) => sample * gain);

/**
 * The shape of speech: bursts standing well above the clip's own floor, with
 * enough quiet windows either side to establish that floor.
 */
const burstsOver = (floorDbfs: number, burstDbfs: number): Float32Array => {
  const samples = constantAt(floorDbfs, 3000);
  samples.fill(10 ** (burstDbfs / 20), 1200, 1800);
  return samples;
};

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

  // Modelled on the one real tap-and-release with nothing said: room tone at
  // -55.2 dBFS carrying a brief transient that lifts its loudest window to
  // -51.6 dBFS. Reproducing the floor as room tone rather than as
  // near-digital-silence matters: it is what makes the clip's dynamic range
  // 3.8 dB, matching the real recording's 3.6 dB. So the clip is quiet AND
  // live, and the two predicates must disagree about it — that disagreement is
  // the whole point of having both.
  it("separates a quiet but live capture from a dead one", () => {
    const samples = Array.from(constantAt(-55.2, 16_000));
    for (let index = 8_000; index < 8_008; index += 1) {
      samples[index] = 0.05;
    }

    expect(maxWindowLoudnessDbfs(samples, 16_000)).toBeCloseTo(-51.4, 0);
    expect(dynamicRangeDb(samples, 16_000)).toBeCloseTo(3.8, 0);
    expect(hasNoSignal(samples)).toBe(false);
    expect(containsSpeech(samples, 16_000)).toBe(false);
  });
});

describe("dynamicRangeDb", () => {
  it("measures a clip's peak against its own floor", () => {
    expect(dynamicRangeDb(burstsOver(-70, -50), SAMPLE_RATE)).toBeCloseTo(
      20,
      1,
    );
  });

  // The property the absolute threshold does not have. Scaling a clip moves
  // its peak and its floor together, so the ratio between them survives a
  // microphone swap or an input-gain change that would invalidate any dBFS
  // constant.
  it("is unchanged by input gain", () => {
    const clip = burstsOver(-70, -50);
    const base = dynamicRangeDb(clip, SAMPLE_RATE);

    expect(dynamicRangeDb(atGain(clip, 0.125), SAMPLE_RATE)).toBeCloseTo(
      base,
      1,
    );
    expect(dynamicRangeDb(atGain(clip, 8), SAMPLE_RATE)).toBeCloseTo(base, 1);
  });

  it("reports no range for a flat clip", () => {
    expect(dynamicRangeDb(constantAt(-52, 3000), SAMPLE_RATE)).toBeCloseTo(
      0,
      1,
    );
  });

  it("reports no range for digital silence", () => {
    expect(dynamicRangeDb(new Float32Array(3000), SAMPLE_RATE)).toBe(0);
  });

  // A clip this short yields a single window, so there is no floor to measure
  // a peak against. Reporting 0 leaves the decision to the absolute threshold
  // rather than inventing a range from one sample point.
  it("reports no range for a clip shorter than two windows", () => {
    expect(dynamicRangeDb(constantAt(-20, 200), SAMPLE_RATE)).toBe(0);
  });

  // A floor of exactly zero is a ratio with no answer. It means part of the
  // device's output is dead, which is a fault rather than evidence of speech,
  // so the range arm abstains and the absolute threshold decides alone.
  it("abstains when the floor is digital silence", () => {
    const samples = new Float32Array(3000);
    samples.fill(10 ** (-70 / 20), 1200, 1800);

    expect(dynamicRangeDb(samples, SAMPLE_RATE)).toBe(0);
    expect(containsSpeech(samples, SAMPLE_RATE)).toBe(false);
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

  // The case the absolute threshold alone gets wrong: a microphone set too
  // quiet puts real speech below -45 dBFS, and dictation disappears with no
  // error. Its dynamic range gives it away as speech regardless of level.
  it("passes speech recorded far below the absolute threshold", () => {
    const clip = burstsOver(-70, -50);

    expect(maxWindowLoudnessDbfs(clip, SAMPLE_RATE)).toBeLessThan(
      SPEECH_THRESHOLD_DBFS,
    );
    expect(containsSpeech(clip, SAMPLE_RATE)).toBe(true);
  });

  // The case the range alone gets wrong, and the reason both arms are kept.
  // Range measures variation, so a short utterance — uniformly loud, with no
  // gaps to establish a floor — reads as flat. Measured on the real corpus:
  // speech clips truncated to their first 600ms range between 0.2 and 18.1 dB.
  it("passes a short loud utterance that has no floor to measure against", () => {
    const clip = constantAt(-20, 200);

    expect(dynamicRangeDb(clip, SAMPLE_RATE)).toBe(0);
    expect(containsSpeech(clip, SAMPLE_RATE)).toBe(true);
  });
});
