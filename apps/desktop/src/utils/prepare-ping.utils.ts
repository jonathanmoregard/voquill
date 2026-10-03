import type { ApiKeyProvider } from "@voquill/types";
import { buildOpenAICompatibleUrl } from "./openai-compatible.utils";
import type { TranscriptionPrefs } from "./user.utils";

/**
 * A local OpenAI-compatible STT router can warm up (clocks, paused background
 * jobs) when told that audio is about to arrive. The ping is a best-effort GET
 * to `<base>/prepare`, built with the same `/v1` rule as the transcription
 * call, and only ever sent to this machine.
 */
export const PREPARE_PING_TIMEOUT_MS = 500;

export type PreparePingCandidate = {
  mode: TranscriptionPrefs["mode"];
  provider?: ApiKeyProvider | null;
  baseUrl?: string | null;
  includeV1Path?: boolean | null;
};

export const isLoopbackHostname = (hostname: string): boolean => {
  const host = hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  return (
    host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host)
  );
};

export const resolvePreparePingUrl = (
  candidate: PreparePingCandidate,
): string | null => {
  if (candidate.mode !== "api" || candidate.provider !== "openai-compatible") {
    return null;
  }

  const endpointBase = buildOpenAICompatibleUrl(
    candidate.baseUrl,
    candidate.includeV1Path,
  );

  let hostname: string;
  try {
    hostname = new URL(endpointBase).hostname;
  } catch {
    return null;
  }

  if (!isLoopbackHostname(hostname)) {
    return null;
  }

  return `${endpointBase}/prepare`;
};
