import { beforeEach, describe, expect, it, vi } from "vitest";
import { storeTranscription, transcribeAudio } from "./transcribe.actions";

const {
  addWordsToCurrentUserMock,
  createTranscriptionMock,
  getAppStateMock,
  invokeMock,
  produceAppStateMock,
  providerTranscribeMock,
  purgeStaleAudioMock,
  warningMock,
} = vi.hoisted(() => ({
  addWordsToCurrentUserMock: vi.fn(),
  createTranscriptionMock: vi.fn(),
  getAppStateMock: vi.fn(),
  invokeMock: vi.fn(),
  produceAppStateMock: vi.fn(),
  providerTranscribeMock: vi.fn(),
  purgeStaleAudioMock: vi.fn(),
  warningMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../repos", () => ({
  getGenerateTextRepo: vi.fn(),
  getTranscribeAudioRepo: () => ({
    repo: { transcribeAudio: providerTranscribeMock },
    apiKeyId: null,
    warnings: [],
  }),
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
    warning: warningMock,
  }),
}));

vi.mock("../utils/user.utils", () => ({
  getMyEffectiveUserId: () => "user-id",
  getMyUser: () => null,
  loadMyEffectiveDictationLanguage: async () => "en",
}));

vi.mock("../utils/prompt.utils", () => ({
  buildLocalizedTranscriptionPrompt: () => "",
  collectDictionaryEntries: () => [],
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

describe("transcribeAudio speech gate", () => {
  const sampleRate = 16_000;
  const samples = Float32Array.from(
    { length: sampleRate },
    (_, index) => 0.01 * Math.sin(index / 10),
  );

  beforeEach(() => {
    vi.resetAllMocks();
    getAppStateMock.mockReturnValue({
      settings: { aiTranscription: { modelSize: null } },
    });
    providerTranscribeMock.mockResolvedValue({ text: "hello", metadata: {} });
  });

  it("skips the provider when the VAD finds no speech", async () => {
    invokeMock.mockResolvedValueOnce([0.01, 0.02, 0.05, 0.01]);

    const result = await transcribeAudio({ samples, sampleRate });

    expect(providerTranscribeMock).not.toHaveBeenCalled();
    expect(result.rawTranscript).toBe("");
  });

  it("sends the original audio to the provider when the VAD finds speech", async () => {
    invokeMock.mockResolvedValueOnce([0.01, 0.8, 0.9, 0.95, 0.9, 0.02]);

    const result = await transcribeAudio({ samples, sampleRate });

    expect(providerTranscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({ samples, sampleRate }),
    );
    expect(result.rawTranscript).toBe("hello");
  });

  it("transcribes anyway when speech detection fails", async () => {
    invokeMock.mockRejectedValueOnce("VAD model missing");

    const result = await transcribeAudio({ samples, sampleRate });

    expect(providerTranscribeMock).toHaveBeenCalled();
    expect(result.rawTranscript).toBe("hello");
    expect(warningMock).toHaveBeenCalledWith(
      expect.stringContaining("VAD model missing"),
    );
  });

  it("does not run the VAD when the device produced no signal", async () => {
    const result = await transcribeAudio({
      samples: new Float32Array(sampleRate),
      sampleRate,
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(providerTranscribeMock).not.toHaveBeenCalled();
    expect(result.rawTranscript).toBe("");
  });
});
