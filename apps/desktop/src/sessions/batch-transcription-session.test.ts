import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchTranscriptionSession } from "./batch-transcription-session";

const { showToastMock, transcribeAudioMock } = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  transcribeAudioMock: vi.fn(),
}));

vi.mock("../actions/toast.actions", () => ({
  showToast: showToastMock,
}));

vi.mock("../actions/transcribe.actions", () => ({
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

describe("BatchTranscriptionSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries once and returns the transcript when the retry succeeds", async () => {
    transcribeAudioMock
      .mockRejectedValueOnce(new Error("Connection error"))
      .mockResolvedValueOnce(successfulTranscription);

    const resultPromise = new BatchTranscriptionSession().finalize(audio);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result.rawTranscript).toBe("Recovered transcript");
    expect(transcribeAudioMock).toHaveBeenCalledTimes(2);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it("returns null after exactly two failed attempts", async () => {
    transcribeAudioMock.mockRejectedValue(new Error("Connection error"));

    const resultPromise = new BatchTranscriptionSession().finalize(audio);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result.rawTranscript).toBeNull();
    expect(transcribeAudioMock).toHaveBeenCalledTimes(2);
    expect(showToastMock).toHaveBeenCalledOnce();
  });

  it("does not retry a successful transcription", async () => {
    transcribeAudioMock.mockResolvedValue(successfulTranscription);

    const result = await new BatchTranscriptionSession().finalize(audio);

    expect(result.rawTranscript).toBe("Recovered transcript");
    expect(transcribeAudioMock).toHaveBeenCalledOnce();
    expect(showToastMock).not.toHaveBeenCalled();
  });
});
