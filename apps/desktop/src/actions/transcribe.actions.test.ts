import { beforeEach, describe, expect, it, vi } from "vitest";
import { storeTranscription } from "./transcribe.actions";

const {
  addWordsToCurrentUserMock,
  createTranscriptionMock,
  getAppStateMock,
  invokeMock,
  produceAppStateMock,
  purgeStaleAudioMock,
} = vi.hoisted(() => ({
  addWordsToCurrentUserMock: vi.fn(),
  createTranscriptionMock: vi.fn(),
  getAppStateMock: vi.fn(),
  invokeMock: vi.fn(),
  produceAppStateMock: vi.fn(),
  purgeStaleAudioMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../repos", () => ({
  getGenerateTextRepo: vi.fn(),
  getTranscribeAudioRepo: vi.fn(),
  getTranscriptionRepo: () => ({
    createTranscription: createTranscriptionMock,
    purgeStaleAudio: purgeStaleAudioMock,
  }),
}));

vi.mock("../store", () => ({
  getAppState: getAppStateMock,
  produceAppState: produceAppStateMock,
}));

vi.mock("../utils/id.utils", () => ({
  createId: () => "transcription-id",
}));

vi.mock("../utils/log.utils", () => ({
  getLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("../utils/user.utils", () => ({
  getMyEffectiveUserId: () => "user-id",
}));

vi.mock("./app.actions", () => ({
  showErrorSnackbar: vi.fn(),
}));

vi.mock("./user.actions", () => ({
  addWordsToCurrentUser: addWordsToCurrentUserMock,
}));

const audio = {
  samples: [0.1, -0.1],
  sampleRate: 48_000,
};

const audioSnapshot = {
  filePath: "/app-data/transcription-audio/transcription-id.wav",
  durationMs: 1,
};

const createInput = (rawTranscript: string | null, warnings: string[]) => ({
  audio,
  rawTranscript,
  sanitizedTranscript: rawTranscript,
  transcript: rawTranscript,
  transcriptionMetadata: {},
  postProcessMetadata: {},
  warnings,
});

describe("storeTranscription", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const state = {
      userPrefs: {
        incognitoModeEnabled: false,
        incognitoModeIncludeInStats: false,
      },
      transcriptionById: {},
      transcriptions: { transcriptionIds: [] },
    };
    getAppStateMock.mockReturnValue(state);
    produceAppStateMock.mockImplementation((producer) => producer(state));
    invokeMock.mockResolvedValue(audioSnapshot);
    createTranscriptionMock.mockImplementation(async (transcription) =>
      Promise.resolve(transcription),
    );
    purgeStaleAudioMock.mockResolvedValue([]);
    addWordsToCurrentUserMock.mockResolvedValue(undefined);
  });

  it("saves audio and a failed history record for a failed transcription", async () => {
    await storeTranscription(
      createInput(null, ["Transcription failed: Error: Connection error"]),
    );

    expect(invokeMock).toHaveBeenCalledWith("store_transcription_audio", {
      id: "transcription-id",
      samples: audio.samples,
      sampleRate: audio.sampleRate,
    });
    expect(createTranscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "transcription-id",
        transcript: "[Transcription Failed]",
        audio: audioSnapshot,
      }),
    );
  });

  it("saves audio and a normal history record for a successful transcription", async () => {
    await storeTranscription(createInput("Transcript", []));

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(createTranscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "transcription-id",
        transcript: "Transcript",
        audio: audioSnapshot,
      }),
    );
  });
});
