import { invoke } from "@tauri-apps/api/core";
import { getAppState } from "../store";
import { AudioSamples } from "../types/audio.types";
import { isLinux, isMacOS, isWindows11 } from "./env.utils";
import { getMyUser } from "./user.utils";

const writeString = (view: DataView, offset: number, text: string) => {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
};

const floatTo16BitPCM = (
  view: DataView,
  offset: number,
  input: Float32Array,
) => {
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset + index * 2, value, true);
  }
};

export const ensureFloat32Array = (
  samples: number[] | Float32Array,
): Float32Array =>
  samples instanceof Float32Array ? samples : Float32Array.from(samples ?? []);

export const buildWaveFile = (
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer => {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  floatTo16BitPCM(view, 44, samples);
  return buffer;
};

export const normalizeSamples = (samples: AudioSamples): number[] =>
  Array.isArray(samples) ? samples : Array.from(samples ?? []);

/**
 * Length of the window the speech gate measures loudness over. Long enough that
 * a keyboard click or chime transient is smeared well below speech level, short
 * enough that a single spoken word still fills it.
 */
export const SPEECH_WINDOW_MS = 300;

/**
 * Loudness a clip must reach in some window to be considered speech, in dBFS.
 * Measured against this user's own recordings: real dictation peaks at -31 dBFS
 * or louder by this metric, an accidental tap-and-release at -52 dBFS. The
 * threshold sits in that gap, closer to the noise side so quiet speech survives.
 */
export const SPEECH_THRESHOLD_DBFS = -45;

const toDbfs = (amplitude: number): number =>
  amplitude > 1e-9 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;

/**
 * Loudness of the loudest window in the clip, in dBFS.
 *
 * Windowed rather than whole-clip: a clip's overall RMS is diluted by its
 * pauses, so a minute of recording holding a single spoken word measures as
 * silence. The loudest window answers the question that actually matters —
 * whether there is speech anywhere in the clip.
 */
export const maxWindowLoudnessDbfs = (
  samples: AudioSamples,
  sampleRate: number,
  windowMs: number = SPEECH_WINDOW_MS,
): number => {
  const values = samples ?? [];
  const length = values.length;
  if (length === 0 || sampleRate <= 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const windowSize = Math.max(
    1,
    Math.min(length, Math.round((sampleRate * windowMs) / 1000)),
  );
  const hop = Math.max(1, Math.floor(windowSize / 2));

  let loudest = 0;
  for (let start = 0; start + windowSize <= length; start += hop) {
    let sumOfSquares = 0;
    for (let index = start; index < start + windowSize; index += 1) {
      const sample = values[index] ?? 0;
      sumOfSquares += sample * sample;
    }
    const rms = Math.sqrt(sumOfSquares / windowSize);
    if (rms > loudest) {
      loudest = rms;
    }
  }

  return toDbfs(loudest);
};

/**
 * Whether the capture device produced no signal at all.
 *
 * A working microphone always dithers: across the recorded clips, even a
 * deliberate tap-and-release with nothing said peaks at 0.05 with 0.5% of its
 * samples at exactly zero. A device that is muted, suspended, or exposing no
 * input stream — a Bluetooth headset in a2dp, say — returns every sample as
 * exactly zero instead. The two cases do not overlap, so this needs no
 * threshold and does not drift with input gain.
 *
 * Worth distinguishing because the two demand opposite responses: silence is a
 * no-op the user intended, no signal is a fault they need told about.
 */
export const hasNoSignal = (samples: AudioSamples): boolean => {
  const values = samples ?? [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== 0) {
      return false;
    }
  }
  return true;
};

/**
 * Whether a clip contains speech loud enough to be worth transcribing.
 *
 * Transcription models have no "silence" output class: handed a clip with no
 * speech they emit their highest-prior continuation, which — when a glossary
 * prompt is supplied — is frequently the prompt itself. Not calling the model
 * is the only reliable fix, so the decision is made here, on the raw capture
 * before any normalization gain is applied.
 */
export const containsSpeech = (
  samples: AudioSamples,
  sampleRate: number,
): boolean =>
  maxWindowLoudnessDbfs(samples, sampleRate) >= SPEECH_THRESHOLD_DBFS;

/**
 * Trailing silence appended to a clip before transcription so speech that
 * runs right up to the stop keypress isn't clipped by the model.
 */
export const TRAILING_SILENCE_MS = 500;

/**
 * Leading window excluded from peak measurement. The interaction chime can
 * bleed into the first moments of a recording and would otherwise set the
 * scale, leaving quiet speech unamplified.
 */
export const PEAK_EXCLUDED_LEADING_MS = 600;

/** Normalization target peak of roughly -3 dBFS. */
export const NORMALIZATION_TARGET_PEAK = 0.708;

/** Maximum normalization gain (+20 dB) so near-silent clips aren't turned into pure noise. */
export const NORMALIZATION_MAX_GAIN = 10;

/**
 * Appends silence to the end of a clip. Whisper-style models tend to drop the
 * final words when speech ends exactly at the clip boundary.
 */
export const appendTrailingSilence = (
  samples: Float32Array,
  sampleRate: number,
  silenceMs: number = TRAILING_SILENCE_MS,
): Float32Array => {
  const padCount = Math.round((sampleRate * silenceMs) / 1000);
  if (samples.length === 0 || padCount <= 0) {
    return samples;
  }
  const padded = new Float32Array(samples.length + padCount);
  padded.set(samples, 0);
  return padded;
};

/**
 * Peak-normalizes a clip for transcription, measuring the peak while
 * excluding the leading chime window so a loud interaction-chime bleed at
 * t=0 doesn't prevent quiet speech from being amplified. Gain is clamped to
 * NORMALIZATION_MAX_GAIN and the output is clamped to [-1, 1] (the excluded
 * leading window may clip, which is acceptable for chime bleed).
 */
export const peakNormalizeForTranscription = (
  samples: Float32Array,
  sampleRate: number,
): Float32Array => {
  if (samples.length === 0) {
    return samples;
  }

  const excludedCount = Math.floor(
    (sampleRate * PEAK_EXCLUDED_LEADING_MS) / 1000,
  );
  // If the whole clip fits inside the excluded window, measure everything.
  const measureStart = excludedCount >= samples.length ? 0 : excludedCount;

  let peak = 0;
  for (let index = measureStart; index < samples.length; index += 1) {
    const magnitude = Math.abs(samples[index] ?? 0);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  // Digital silence: amplifying would only manufacture noise.
  if (peak < 1e-6) {
    return samples;
  }

  const gain = Math.min(
    NORMALIZATION_TARGET_PEAK / peak,
    NORMALIZATION_MAX_GAIN,
  );
  if (Math.abs(gain - 1) < 1e-3) {
    return samples;
  }

  const normalized = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    normalized[index] = Math.max(-1, Math.min(1, (samples[index] ?? 0) * gain));
  }
  return normalized;
};

export type AudioClip =
  | "start_recording_clip"
  | "stop_recording_clip"
  | "alert_linux_clip"
  | "alert_macos_clip"
  | "alert_windows_10_clip"
  | "alert_windows_11_clip";

export function tryPlayAudioChime(clip: AudioClip): void {
  const state = getAppState();
  const user = getMyUser(state);
  const playInteractionChime = user?.playInteractionChime ?? true;

  if (!playInteractionChime) {
    return;
  }

  invoke<void>("play_audio", { clip }).catch(console.error);
}

function getAlertClip(): AudioClip {
  if (isMacOS()) {
    return "alert_macos_clip";
  }
  if (isLinux()) {
    return "alert_linux_clip";
  }
  if (isWindows11()) {
    return "alert_windows_11_clip";
  }
  return "alert_windows_10_clip";
}

export function playAlertSound(): void {
  const clip = getAlertClip();
  tryPlayAudioChime(clip);
}
