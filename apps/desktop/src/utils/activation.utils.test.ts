import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivationController,
  hasNewlyActiveController,
  snapshotControllerActivity,
} from "./activation.utils";

const noop = () => undefined;

const track = () => {
  const calls = { activate: 0, deactivate: 0 };
  const controller = new ActivationController(
    () => {
      calls.activate += 1;
    },
    () => {
      calls.deactivate += 1;
    },
  );
  return { controller, calls };
};

describe("hold-only activation", () => {
  it("stops on release even when the press was far shorter than a tap", () => {
    const { controller, calls } = track();

    controller.handlePress();
    controller.handleRelease();

    expect(controller.isActive).toBe(false);
    expect(calls).toEqual({ activate: 1, deactivate: 1 });
  });

  it("never latches, however many quick taps arrive", () => {
    const { controller, calls } = track();

    for (let i = 0; i < 3; i += 1) {
      controller.handlePress();
      controller.handleRelease();
      expect(controller.isActive).toBe(false);
    }

    expect(calls).toEqual({ activate: 3, deactivate: 3 });
  });

  it("stays active for the whole hold", () => {
    const { controller, calls } = track();

    controller.handlePress();
    expect(controller.isActive).toBe(true);
    expect(calls.deactivate).toBe(0);

    controller.handleRelease();
    expect(controller.isActive).toBe(false);
  });
});

describe("hold delay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores a click released before the delay", () => {
    const { controller, calls } = track();

    controller.handlePress(220);
    vi.advanceTimersByTime(219);
    controller.handleRelease();
    vi.advanceTimersByTime(1000);

    expect(controller.isActive).toBe(false);
    expect(calls).toEqual({ activate: 0, deactivate: 0 });
  });

  it("activates once the press outlasts the delay, and stops on release", () => {
    const { controller, calls } = track();

    controller.handlePress(220);
    vi.advanceTimersByTime(220);
    expect(controller.isActive).toBe(true);

    controller.handleRelease();
    expect(controller.isActive).toBe(false);
    expect(calls).toEqual({ activate: 1, deactivate: 1 });
  });

  it("drops a pending activation on reset", () => {
    const { controller, calls } = track();

    controller.handlePress(220);
    controller.forceReset();
    vi.advanceTimersByTime(1000);

    expect(calls.activate).toBe(0);
  });
});

describe("controller activity snapshots", () => {
  it("reports no newly active controller when nothing is active", () => {
    const controllers = [
      new ActivationController(noop, noop),
      new ActivationController(noop, noop),
    ];
    const snapshot = snapshotControllerActivity(controllers);
    expect(hasNewlyActiveController(snapshot)).toBe(false);
  });

  it("detects a hold that started after the snapshot", () => {
    const controller = new ActivationController(noop, noop);
    const snapshot = snapshotControllerActivity([controller]);

    // A new hold starts while the stop pipeline is still running.
    controller.handlePress();

    expect(hasNewlyActiveController(snapshot)).toBe(true);
  });

  it("does not flag a controller that was already active at snapshot time", () => {
    // Auto-stop can fire while a locked hold is still active; the reset must
    // still run in that case to bring the stale controller back in sync.
    const controller = new ActivationController(noop, noop);
    controller.toggle(); // locked active
    expect(controller.isActive).toBe(true);

    const snapshot = snapshotControllerActivity([controller]);
    expect(hasNewlyActiveController(snapshot)).toBe(false);
  });

  it("does not flag a controller that deactivated during the pipeline", () => {
    const controller = new ActivationController(noop, noop);
    controller.toggle();
    const snapshot = snapshotControllerActivity([controller]);
    controller.toggle(); // released/ended during pipeline
    expect(hasNewlyActiveController(snapshot)).toBe(false);
  });

  it("flags a mix where one controller is stale and another is newly active", () => {
    const stale = new ActivationController(noop, noop);
    stale.toggle();
    const fresh = new ActivationController(noop, noop);

    const snapshot = snapshotControllerActivity([stale, fresh]);
    fresh.handlePress();

    expect(hasNewlyActiveController(snapshot)).toBe(true);
  });
});
