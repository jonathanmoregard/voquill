use std::path::Path;
use whisper_rs::{WhisperVadContext, WhisperVadContextParams};

pub const VAD_MODEL_RESOURCE: &str = "resources/ggml-silero-v6.2.0.bin";

/// Per-frame speech probabilities from Silero VAD, one per 32 ms frame.
/// `samples` must be 16 kHz mono.
pub fn speech_probabilities(model_path: &Path, samples: &[f32]) -> Result<Vec<f32>, String> {
    let model_path = model_path
        .to_str()
        .ok_or_else(|| format!("VAD model path is not UTF-8: {}", model_path.display()))?;
    let mut params = WhisperVadContextParams::new();
    params.set_n_threads(1);
    let mut context = WhisperVadContext::new(model_path, params)
        .map_err(|err| format!("Failed to load VAD model {model_path}: {err}"))?;
    context
        .detect_speech(samples)
        .map_err(|err| format!("VAD inference failed: {err}"))?;
    Ok(context.probabilities().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const VAD_SAMPLE_RATE: u32 = 16_000;
    const SPEECH_PROBABILITY: f32 = 0.3;

    fn manifest_path(relative: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
    }

    fn model_path() -> PathBuf {
        manifest_path(VAD_MODEL_RESOURCE)
    }

    fn resample_to_vad_rate(samples: &[f32], rate: u32) -> Vec<f32> {
        let step = rate as f64 / VAD_SAMPLE_RATE as f64;
        let length = (samples.len() as f64 / step).floor() as usize;
        (0..length)
            .map(|index| {
                let position = index as f64 * step;
                let lower = position.floor() as usize;
                let upper = (lower + 1).min(samples.len() - 1);
                let fraction = (position - lower as f64) as f32;
                samples[lower] + (samples[upper] - samples[lower]) * fraction
            })
            .collect()
    }

    fn speech_frames(probabilities: &[f32]) -> usize {
        probabilities
            .iter()
            .filter(|&&probability| probability >= SPEECH_PROBABILITY)
            .count()
    }

    #[test]
    fn digital_silence_has_no_speech_frames() {
        let silence = vec![0.0; VAD_SAMPLE_RATE as usize];

        let probabilities = speech_probabilities(&model_path(), &silence).unwrap();

        assert!(!probabilities.is_empty());
        assert_eq!(speech_frames(&probabilities), 0);
    }

    #[test]
    fn recorded_speech_has_many_speech_frames() {
        let mut reader = hound::WavReader::open(manifest_path(
            "../../../packages/rust_transcription/assets/test.wav",
        ))
        .unwrap();
        let rate = reader.spec().sample_rate;
        let samples: Vec<f32> = reader
            .samples::<i16>()
            .map(|sample| sample.unwrap() as f32 / 32768.0)
            .collect();

        let probabilities =
            speech_probabilities(&model_path(), &resample_to_vad_rate(&samples, rate)).unwrap();

        assert!(speech_frames(&probabilities) >= 10);
    }

    #[test]
    fn missing_model_is_an_error() {
        let result = speech_probabilities(&manifest_path("resources/missing.bin"), &[0.0; 512]);

        assert!(result.is_err());
    }
}
