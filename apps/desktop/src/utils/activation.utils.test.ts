import { describe, expect, it } from "vitest";
import {
  ActivationController,
  hasNewlyActiveController,
  snapshotControllerActivity,
} from "./activation.utils";

const noop = () => undefined;

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
