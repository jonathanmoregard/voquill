import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

import { useTauriListen } from "../../hooks/tauri.hooks";
import { useAppStore } from "../../store";
import { getMyUserPreferences } from "../../utils/user.utils";

type PitchPayload = { hz: number };

export const PitchFeedbackSideEffects = () => {
  const prefs = useAppStore((state) => getMyUserPreferences(state));
  const enabled = prefs?.pitchFeedbackEnabled ?? false;
  const threshold = prefs?.pitchThresholdHz ?? 155;
  const window = prefs?.pitchTransitionWindowHz ?? 2;

  const lastBlendRef = useRef<number | null>(null);

  useTauriListen<PitchPayload>("recording_pitch", (payload) => {
    if (!enabled) return;
    const hz = payload?.hz ?? 0;
    if (hz <= 0) return; // unvoiced frame: keep last color
    const halfWindow = Math.max(window / 2, 0.001);
    const low = threshold - halfWindow;
    const t = Math.max(0, Math.min(1, (hz - low) / Math.max(window, 0.001)));
    const rounded = Math.round(t * 100) / 100;
    if (lastBlendRef.current === rounded) return;
    lastBlendRef.current = rounded;
    invoke("set_pill_pitch_blend", { t: rounded }).catch(console.error);
  });

  useEffect(() => {
    if (!enabled) {
      lastBlendRef.current = null;
    }
  }, [enabled]);

  return null;
};
