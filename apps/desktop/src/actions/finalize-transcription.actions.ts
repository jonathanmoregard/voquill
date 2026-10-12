import {
  StopRecordingResponse,
  TranscriptionSession,
  TranscriptionSessionFinalizeOptions,
  TranscriptionSessionResult,
} from "../types/transcription-session.types";
import { storeTranscription } from "./transcribe.actions";

export type FinalizeTranscriptionSessionInput = {
  audio: StopRecordingResponse;
  session: TranscriptionSession | null | undefined;
  options?: TranscriptionSessionFinalizeOptions;
};

export const finalizeTranscriptionSession = async ({
  audio,
  session,
  options,
}: FinalizeTranscriptionSessionInput): Promise<
  TranscriptionSessionResult | undefined
> => {
  const result = await session?.finalize(audio, options);

  const hasAudio = (audio.samples?.length ?? 0) > 0;
  if (result?.rawTranscript === null && hasAudio) {
    await storeTranscription({
      audio,
      rawTranscript: null,
      sanitizedTranscript: null,
      transcript: null,
      transcriptionMetadata: result.metadata,
      postProcessMetadata: result.postProcessMetadata ?? {},
      warnings: result.warnings,
    });
  }

  return result;
};
