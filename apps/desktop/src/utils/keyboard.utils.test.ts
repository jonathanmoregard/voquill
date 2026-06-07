import { describe, expect, it } from "vitest";
import { comboStillHeld, matchesComboExactly } from "./keyboard.utils";

describe("matchesComboExactly", () => {
  it("matches when held keys equal the combo", () => {
    expect(matchesComboExactly(["ControlRight"], ["ControlRight"])).toBe(true);
    expect(
      matchesComboExactly(["ControlLeft", "Space"], ["ControlLeft", "Space"]),
    ).toBe(true);
  });

  it("matches regardless of order and case", () => {
    expect(
      matchesComboExactly(["space", "controlleft"], ["ControlLeft", "Space"]),
    ).toBe(true);
  });

  it("ignores duplicate held keys", () => {
    expect(
      matchesComboExactly(["ControlRight", "controlright"], ["ControlRight"]),
    ).toBe(true);
  });

  it("does not match when a combo key is missing", () => {
    expect(matchesComboExactly(["ControlLeft"], ["ControlLeft", "Space"])).toBe(
      false,
    );
  });

  it("does not match when an extra key is held", () => {
    expect(
      matchesComboExactly(["ControlRight", "Unknown(248)"], ["ControlRight"]),
    ).toBe(false);
  });

  it("does not match an empty combo", () => {
    expect(matchesComboExactly([], [])).toBe(false);
    expect(matchesComboExactly(["Space"], [])).toBe(false);
  });
});

describe("comboStillHeld", () => {
  it("is true while all combo keys remain held", () => {
    expect(comboStillHeld(["ControlRight"], ["ControlRight"])).toBe(true);
    expect(
      comboStillHeld(["ControlLeft", "Space"], ["ControlLeft", "Space"]),
    ).toBe(true);
  });

  it("tolerates stray extra keys (e.g. headset media key events)", () => {
    expect(
      comboStillHeld(["ControlRight", "Unknown(248)"], ["ControlRight"]),
    ).toBe(true);
    expect(
      comboStillHeld(
        ["ControlLeft", "Space", "Unknown(248)"],
        ["ControlLeft", "Space"],
      ),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(comboStillHeld(["controlright"], ["ControlRight"])).toBe(true);
  });

  it("is false once a combo key is released", () => {
    expect(comboStillHeld([], ["ControlRight"])).toBe(false);
    expect(comboStillHeld(["Unknown(248)"], ["ControlRight"])).toBe(false);
    expect(comboStillHeld(["ControlLeft"], ["ControlLeft", "Space"])).toBe(
      false,
    );
  });

  it("is false for an empty combo", () => {
    expect(comboStillHeld(["Space"], [])).toBe(false);
  });
});
