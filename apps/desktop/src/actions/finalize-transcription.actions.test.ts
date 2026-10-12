import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchTranscriptionSession } from "../sessions/batch-transcription-session";
import { finalizeTranscriptionSession } from "./finalize-transcription.actions";

const { storeTranscriptionMock, transcribeAudioMock } = vi.hoisted(() => ({
  storeTranscriptionMock: vi.fn(),
  transcribeAudioMock: vi.fn(),
}));

vi.mock("./toast.actions", () => ({
  showToast: vi.fn(),
}));

vi.mock("./transcribe.actions", () => ({
  storeTranscription: storeTranscriptionMock,
  transcribeAudio: transcribeAudioMock,
}));

vi.mock("../utils/log.utils", () => ({
  getLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const audio = {
  samples: [0.1, -0.1],
  sampleRate: 48_000,
};

const successfulTranscription = {
  rawTranscript: "Recovered transcript",
  metadata: {},
  warnings: [],
};

describe("finalizeTranscriptionSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    storeTranscriptionMock.mockResolvedValue({
      transcription: null,
      wordCount: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a transcript without storing a failed record when the retry succeeds", async () => {
    transcribeAudioMock
      .mockRejectedValueOnce(new Error("Connection error"))
      .mockResolvedValueOnce(successfulTranscription);

    const resultPromise = finalizeTranscriptionSession({
      audio,
      session: new BatchTranscriptionSession(),
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result?.rawTranscript).toBe("Recovered transcript");
    expect(transcribeAudioMock).toHaveBeenCalledTimes(2);
    expect(storeTranscriptionMock).not.toHaveBeenCalled();
  });

  it("saves audio and a failed record after exactly two failed attempts", async () => {
    transcribeAudioMock.mockRejectedValue(new Error("Connection error"));

    const resultPromise = finalizeTranscriptionSession({
      audio,
      session: new BatchTranscriptionSession(),
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result?.rawTranscript).toBeNull();
    expect(transcribeAudioMock).toHaveBeenCalledTimes(2);
    expect(storeTranscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audio,
        rawTranscript: null,
        warnings: ["Transcription failed: Error: Connection error"],
      }),
    );
  });

  it("transcribes once and does not store a failed record on immediate success", async () => {
    transcribeAudioMock.mockResolvedValue(successfulTranscription);

    const result = await finalizeTranscriptionSession({
      audio,
      session: new BatchTranscriptionSession(),
    });

    expect(result?.rawTranscript).toBe("Recovered transcript");
    expect(transcribeAudioMock).toHaveBeenCalledOnce();
    expect(storeTranscriptionMock).not.toHaveBeenCalled();
  });
});
