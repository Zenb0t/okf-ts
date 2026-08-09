import { describe, expect, it } from "vitest";

import {
  deriveTrustTier,
  getStatus,
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
