import { describe, expect, it } from "vitest";
import {
  isLoopbackHostname,
  PREPARE_PING_TIMEOUT_MS,
  resolvePreparePingUrl,
} from "./prepare-ping.utils";

describe("isLoopbackHostname", () => {
  it("accepts the loopback hosts a local STT router listens on", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("LocalHost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("127.0.0.2")).toBe(true);
  });

  it("rejects every host that is not this machine", () => {
    expect(isLoopbackHostname("api.openai.com")).toBe(false);
    expect(isLoopbackHostname("192.168.1.10")).toBe(false);
    expect(isLoopbackHostname("10.0.0.5")).toBe(false);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
    expect(isLoopbackHostname("localhost.example.com")).toBe(false);
    expect(isLoopbackHostname("")).toBe(false);
  });
});

describe("resolvePreparePingUrl", () => {
  const localRouter = {
    mode: "api" as const,
    provider: "openai-compatible" as const,
    baseUrl: "http://127.0.0.1:8766",
  };

  it("pings <base>/v1/prepare when the key includes the /v1 path", () => {
    expect(resolvePreparePingUrl({ ...localRouter, includeV1Path: true })).toBe(
      "http://127.0.0.1:8766/v1/prepare",
    );
  });

  it("pings <base>/prepare when the key excludes the /v1 path", () => {
    expect(
      resolvePreparePingUrl({ ...localRouter, includeV1Path: false }),
    ).toBe("http://127.0.0.1:8766/prepare");
  });

  it("defaults to the /v1 path like the transcription call does", () => {
    expect(resolvePreparePingUrl(localRouter)).toBe(
      "http://127.0.0.1:8766/v1/prepare",
    );
    expect(resolvePreparePingUrl({ ...localRouter, includeV1Path: null })).toBe(
      "http://127.0.0.1:8766/v1/prepare",
    );
  });

  it("does not double a /v1 the user already typed into the base URL", () => {
    expect(
      resolvePreparePingUrl({
        ...localRouter,
        baseUrl: "http://127.0.0.1:8766/v1",
        includeV1Path: true,
      }),
    ).toBe("http://127.0.0.1:8766/v1/prepare");
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(
      resolvePreparePingUrl({
        ...localRouter,
        baseUrl: "http://localhost:8766/",
        includeV1Path: true,
      }),
    ).toBe("http://localhost:8766/v1/prepare");
  });

  it("accepts the other loopback spellings", () => {
    expect(
      resolvePreparePingUrl({
        ...localRouter,
        baseUrl: "http://localhost:8766",
      }),
    ).toBe("http://localhost:8766/v1/prepare");
    expect(
      resolvePreparePingUrl({ ...localRouter, baseUrl: "http://[::1]:8766" }),
    ).toBe("http://[::1]:8766/v1/prepare");
  });

  it("falls back to the provider's loopback default when no base URL is set", () => {
    expect(resolvePreparePingUrl({ ...localRouter, baseUrl: null })).toBe(
      "http://127.0.0.1:8080/v1/prepare",
    );
  });

  it("never pings for cloud or local transcription modes", () => {
    expect(resolvePreparePingUrl({ mode: "cloud" })).toBeNull();
    expect(resolvePreparePingUrl({ mode: "local" })).toBeNull();
    expect(
      resolvePreparePingUrl({
        mode: "local",
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:8766",
      }),
    ).toBeNull();
  });

  it("never pings other API providers, even on loopback", () => {
    expect(
      resolvePreparePingUrl({
        mode: "api",
        provider: "groq",
        baseUrl: "http://127.0.0.1:8766",
      }),
    ).toBeNull();
    expect(
      resolvePreparePingUrl({
        mode: "api",
        provider: "speaches",
        baseUrl: "http://127.0.0.1:8000",
      }),
    ).toBeNull();
    expect(
      resolvePreparePingUrl({
        mode: "api",
        provider: "ollama",
        baseUrl: "http://localhost:11434",
      }),
    ).toBeNull();
  });

  it("never pings an openai-compatible endpoint on another host", () => {
    expect(
      resolvePreparePingUrl({
        ...localRouter,
        baseUrl: "https://api.openai.com/v1",
      }),
    ).toBeNull();
    expect(
      resolvePreparePingUrl({
        ...localRouter,
        baseUrl: "http://192.168.1.10:8766",
      }),
    ).toBeNull();
    expect(
      resolvePreparePingUrl({
        ...localRouter,
        baseUrl: "http://localhost.example.com:8766",
      }),
    ).toBeNull();
  });

  it("gives up quietly on an unparsable base URL", () => {
    expect(
      resolvePreparePingUrl({ ...localRouter, baseUrl: "not a url" }),
    ).toBeNull();
  });
});

describe("PREPARE_PING_TIMEOUT_MS", () => {
  it("stays well under the time the audio takes to arrive", () => {
    expect(PREPARE_PING_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PREPARE_PING_TIMEOUT_MS).toBeLessThanOrEqual(500);
  });
});
