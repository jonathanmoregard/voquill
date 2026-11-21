import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, keysHeld, warningMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  keysHeld: { current: [] as string[] },
  warningMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../store", () => ({
  getAppState: () => ({ keysHeld: keysHeld.current }),
}));
vi.mock("../actions/app-target.actions", () => ({
  tryRegisterCurrentAppTarget: vi.fn(async () => null),
}));
vi.mock("../utils/log.utils", () => ({
  getLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warning: warningMock,
  }),
}));

import { DictationStrategy } from "./dictation.strategy";

const holdAndRelease = async (keys: string[]): Promise<void> => {
  keysHeld.current = keys;
  const strategy = new DictationStrategy();
  await strategy.onBeforeStart();
  keysHeld.current = [];
  await strategy.onBeforeStop();
};

describe("DictationStrategy.onBeforeStop", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("focuses the window under the pointer when the hold included the middle mouse button", async () => {
    await holdAndRelease(["ControlLeft", "MiddleMouse"]);

    expect(invokeMock).toHaveBeenCalledWith("focus_window_under_pointer");
  });

  it("leaves focus alone when the hold was keyboard only", async () => {
    await holdAndRelease(["ControlRight"]);

    expect(invokeMock).not.toHaveBeenCalledWith("focus_window_under_pointer");
  });

  it("logs a focus failure instead of aborting the stop", async () => {
    invokeMock.mockRejectedValue("window manager did not respond");

    await expect(holdAndRelease(["MiddleMouse"])).resolves.toBeUndefined();
    expect(warningMock).toHaveBeenCalledWith(
      "Failed to focus the window under the pointer: window manager did not respond",
    );
  });
});
