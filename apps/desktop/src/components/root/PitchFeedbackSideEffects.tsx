import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

import { useTauriListen } from "../../hooks/tauri.hooks";
import { useAppStore } from "../../store";
import { getMyUserPreferences } from "../../utils/user.utils";

type PitchPayload = { hz: number };
type PitchColor = "neutral" | "green" | "red";

export const PitchFeedbackSideEffects = () => {
  const prefs = useAppStore((state) => getMyUserPreferences(state));
  const enabled = prefs?.pitchFeedbackEnabled ?? false;
  const threshold = prefs?.pitchThresholdHz ?? 155;

  const lastColorRef = useRef<PitchColor | null>(null);

  useTauriListen<PitchPayload>("recording_pitch", (payload) => {
    const hz = payload?.hz ?? 0;
    const color: PitchColor = !enabled || hz <= 0
      ? "neutral"
      : hz < threshold
        ? "green"
        : "red";
    if (lastColorRef.current === color) return;
    lastColorRef.current = color;
    invoke("set_pill_pitch_color", { color }).catch(console.error);
  });

  useEffect(() => {
    if (!enabled && lastColorRef.current !== "neutral") {
      lastColorRef.current = "neutral";
      invoke("set_pill_pitch_color", { color: "neutral" }).catch(console.error);
    }
  }, [enabled]);

  return null;
};
