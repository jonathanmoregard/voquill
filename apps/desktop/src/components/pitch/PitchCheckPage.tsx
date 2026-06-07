import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";
import { showErrorSnackbar } from "../../actions/app.actions";
import {
  setPitchFeedbackEnabled,
  setPitchThresholdHz,
  setPitchTransitionWindowHz,
} from "../../actions/user.actions";
import { useAppStore } from "../../store";
import { getMyUserPreferences } from "../../utils/user.utils";
import { SettingSection } from "../common/SettingSection";

const CALIBRATE_DURATION_MS = 3000;
const CALIBRATE_OFFSET_HZ = 3;

export default function PitchCheckPage() {
  const prefs = useAppStore((state) => getMyUserPreferences(state));
  const pitchFeedbackEnabled = prefs?.pitchFeedbackEnabled ?? false;
  const pitchThresholdHz = prefs?.pitchThresholdHz ?? 155;
  const pitchTransitionWindowHz = prefs?.pitchTransitionWindowHz ?? 2;

  const [thresholdInput, setThresholdInput] = useState(
    String(pitchThresholdHz),
  );
  const [windowInput, setWindowInput] = useState(
    String(pitchTransitionWindowHz),
  );
  const lastCommittedRef = useRef(pitchThresholdHz);
  const lastCommittedWindowRef = useRef(pitchTransitionWindowHz);
  const [isCalibrating, setIsCalibrating] = useState(false);

  useEffect(() => {
    lastCommittedRef.current = pitchThresholdHz;
    setThresholdInput(String(pitchThresholdHz));
  }, [pitchThresholdHz]);

  useEffect(() => {
    lastCommittedWindowRef.current = pitchTransitionWindowHz;
    setWindowInput(String(pitchTransitionWindowHz));
  }, [pitchTransitionWindowHz]);

  const commitWindow = () => {
    if (windowInput === "") {
      setWindowInput(String(pitchTransitionWindowHz));
      return;
    }
    const parsed = Number(windowInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setWindowInput(String(pitchTransitionWindowHz));
      return;
    }
    const normalized = Math.max(0, Math.min(200, parsed));
    setWindowInput(String(normalized));
    if (normalized === lastCommittedWindowRef.current) return;
    lastCommittedWindowRef.current = normalized;
    void setPitchTransitionWindowHz(normalized);
  };

  const commitThreshold = () => {
    if (thresholdInput === "") {
      setThresholdInput(String(pitchThresholdHz));
      return;
    }
    const parsed = Number(thresholdInput);
    if (!Number.isFinite(parsed)) {
      setThresholdInput(String(pitchThresholdHz));
      return;
    }
    const normalized = Math.max(50, Math.min(400, Math.round(parsed)));
    setThresholdInput(String(normalized));
    if (normalized === lastCommittedRef.current) return;
    lastCommittedRef.current = normalized;
    void setPitchThresholdHz(normalized);
  };

  const handleCalibrate = async () => {
    setIsCalibrating(true);
    try {
      const medianHz = await invoke<number>("calibrate_pitch", {
        durationMs: CALIBRATE_DURATION_MS,
      });
      const target = Math.round(medianHz + CALIBRATE_OFFSET_HZ);
      const clamped = Math.max(50, Math.min(400, target));
      setThresholdInput(String(clamped));
      lastCommittedRef.current = clamped;
      await setPitchThresholdHz(clamped);
    } catch (error) {
      showErrorSnackbar(error);
    } finally {
      setIsCalibrating(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 720, mx: "auto", px: 3, py: 4 }}>
      <Stack spacing={3}>
        <Stack spacing={0.5}>
          <Typography variant="h5" fontWeight={700}>
            <FormattedMessage defaultMessage="Pitch check" />
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <FormattedMessage defaultMessage="Visual feedback on the recording pill when your pitch is below or above a target threshold. Useful for practicing speaking in a lower register." />
          </Typography>
        </Stack>

        <SettingSection
          title={<FormattedMessage defaultMessage="Enable pitch feedback" />}
          description={
            <FormattedMessage defaultMessage="Color the waveform lines green (thicker) when below the threshold, red when above." />
          }
          action={
            <Switch
              edge="end"
              checked={pitchFeedbackEnabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                void setPitchFeedbackEnabled(event.target.checked)
              }
            />
          }
        />

        <SettingSection
          title={<FormattedMessage defaultMessage="Threshold (Hz)" />}
          description={
            <FormattedMessage defaultMessage="Below this pitch the waveform is green, above it red. Typical male low is 100–140 Hz, neutral 150–200 Hz." />
          }
          action={
            <TextField
              size="small"
              type="number"
              value={thresholdInput}
              disabled={!pitchFeedbackEnabled}
              onChange={(event) => setThresholdInput(event.target.value)}
              onBlur={commitThreshold}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              inputProps={{ min: 50, max: 400, step: 1 }}
              sx={{ width: 110 }}
            />
          }
        />

        <SettingSection
          title={<FormattedMessage defaultMessage="Transition window (Hz)" />}
          description={
            <FormattedMessage defaultMessage="Hz range centered on the threshold where the color fades from green to red. Smaller = sharper transition." />
          }
          action={
            <TextField
              size="small"
              type="number"
              value={windowInput}
              disabled={!pitchFeedbackEnabled}
              onChange={(event) => setWindowInput(event.target.value)}
              onBlur={commitWindow}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              inputProps={{ min: 0, max: 200, step: 0.5 }}
              sx={{ width: 110 }}
            />
          }
        />

        <SettingSection
          title={<FormattedMessage defaultMessage="Record your pitch" />}
          description={
            <FormattedMessage defaultMessage="Listens for 3 seconds and sets the threshold to your median pitch + 3 Hz." />
          }
          action={
            <Button
              variant="contained"
              disabled={!pitchFeedbackEnabled || isCalibrating}
              onClick={() => void handleCalibrate()}
              startIcon={
                isCalibrating ? (
                  <CircularProgress size={16} color="inherit" />
                ) : undefined
              }
            >
              {isCalibrating ? (
                <FormattedMessage defaultMessage="Listening…" />
              ) : (
                <FormattedMessage defaultMessage="Record pitch (3s)" />
              )}
            </Button>
          }
        />
      </Stack>
    </Box>
  );
}
