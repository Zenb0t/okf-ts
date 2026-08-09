import { describe, expect, it } from "vitest";

import {
  deriveTrustTier,
  getStatus,
  isIsoDateTime,
  isOkfActor,
  isStale,
  normalizeVerified
} from "../src/index.js";

describe("trust helpers", () => {
  it("derives the three trust tiers", () => {
    expect(deriveTrustTier({ type: "Metric" })).toBe("unverified");
    expect(
      deriveTrustTier({
        type: "Metric",
        verified: [{ by: "process:nightly", at: "2026-08-01T00:00:00Z" }]
      })
    ).toBe("machine-confirmed");
    expect(
      deriveTrustTier({
        type: "Metric",
        verified: [
          { by: "process:nightly", at: "2026-08-01T00:00:00Z" },
          { by: "human:ada", at: "2026-08-02T00:00:00Z" }
        ]
      })
    ).toBe("human-reviewed");
    expect(
      deriveTrustTier({
        metadata: {
          type: "Metric",
          verified: { by: "human:grace", at: "2026-08-03T00:00:00Z" }
        },
        body: ""
      })
    ).toBe("human-reviewed");
  });

  it("normalizes absent, singular, and list verification values", () => {
    const verification = { by: "human:ada", at: "2026-08-01T00:00:00Z" };

    expect(normalizeVerified(undefined)).toEqual([]);
    expect(normalizeVerified(verification)).toEqual([verification]);
    expect(normalizeVerified([verification])).toEqual([verification]);
    expect(normalizeVerified("invalid")).toEqual([]);
  });

  it("only derives trust from actors that follow the OKF convention", () => {
    expect(
      deriveTrustTier({
        type: "Metric",
        verified: [{ by: "ada", at: "2026-08-01T00:00:00Z" }]
      })
    ).toBe("unverified");
    expect(isOkfActor("human:ada")).toBe(true);
    expect(isOkfActor("process:finance-nightly")).toBe(true);
    expect(isOkfActor("reference-agent/v1")).toBe(true);
    expect(isOkfActor("ada")).toBe(false);
    expect(isOkfActor("human:")).toBe(false);
    expect(isOkfActor("agent/version/extra")).toBe(false);
    expect(isOkfActor("process:nightly job")).toBe(false);
    expect(isOkfActor("human:ada\n")).toBe(false);
    expect(isOkfActor(42)).toBe(false);
  });

  it("only derives trust from complete verification events", () => {
    expect(
      deriveTrustTier({
        verified: [{ by: "human:ada" }]
      })
    ).toBe("unverified");
    expect(
      deriveTrustTier({
        verified: [{ by: "human:ada", at: "2026-02-30T00:00:00Z" }]
      })
    ).toBe("unverified");
    expect(
      deriveTrustTier({
        verified: [
          { by: "human:ada", at: "yesterday" },
          { by: "process:nightly", at: "2026-08-01T00:00:00Z" }
        ]
      })
    ).toBe("machine-confirmed");
  });
});

describe("ISO datetime validation", () => {
  it.each([
    "2026-08-01T10:00Z",
    "2026-08-01T10:00:00Z",
    "2026-08-01T10:00:00.123456-07:00",
    "2026-08-01T10:00:00",
    "2026-08-01T24:00:00Z",
    "2026-08-01T10:00:00+23:59"
  ])("accepts %s", (value) => {
    expect(isIsoDateTime(value)).toBe(true);
  });

  it.each([
    "2026-02-30T00:00:00Z",
    "2026-08-01T25:00:00Z",
    "2026-08-01T10:60:00Z",
    "2026-08-01T10:00:61Z",
    "2026-08-01T24:00:00.001Z",
    "2026-08-01T10:00:00+24:00",
    "2026-08-01T10:00:00Z\n",
    "2026-08-01"
  ])("rejects %s", (value) => {
    expect(isIsoDateTime(value)).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isIsoDateTime(null)).toBe(false);
  });
});

describe("lifecycle helpers", () => {
  it("treats a concept as stale on and after its absolute date", () => {
    const metadata = { type: "Metric", stale_after: "2026-09-23" };

    expect(isStale(metadata, new Date("2026-09-22T23:59:59Z"))).toBe(false);
    expect(isStale(metadata, new Date("2026-09-23T00:00:00Z"))).toBe(true);
    expect(isStale(metadata, new Date("2026-10-01T00:00:00Z"))).toBe(true);
  });

  it("does not infer staleness from missing or malformed fields", () => {
    expect(isStale({ type: "Metric" }, new Date("2026-09-23T00:00:00Z"))).toBe(
      false
    );
    expect(
      isStale(
        { type: "Metric", stale_after: "tomorrow" },
        new Date("2026-09-23T00:00:00Z")
      )
    ).toBe(false);
    expect(
      isStale(
        { type: "Metric", stale_after: "2026-02-30" },
        new Date("2026-03-01T00:00:00Z")
      )
    ).toBe(false);
    expect(
      isStale(
        { type: "Metric", stale_after: "2026-09-23" },
        new Date("invalid")
      )
    ).toBe(false);
  });

  it("defaults lifecycle status to stable", () => {
    expect(getStatus({ type: "Metric" })).toBe("stable");
    expect(getStatus({ type: "Metric", status: "draft" })).toBe("draft");
    expect(getStatus({ type: "Metric", status: "unknown" })).toBe("stable");
  });
});
