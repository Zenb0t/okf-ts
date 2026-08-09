import { describe, expect, expectTypeOf, it } from "vitest";

import {
  isWellFormedConcept,
  normalizeVerified,
  parseConcept,
  type OkfRawConcept,
  type OkfVerification,
  type WellFormedOkfConcept
} from "../src/index.js";

describe("untrusted and validated public types", () => {
  it("keeps parsed frontmatter unknown until validation", () => {
    const concept = parseConcept("---\ntype: 42\n---\n");

    expectTypeOf(concept).toEqualTypeOf<OkfRawConcept>();
    expectTypeOf(concept.metadata.type).toEqualTypeOf<unknown>();
    expect(concept.metadata.type).toBe(42);
    expect(isWellFormedConcept(concept)).toBe(false);
  });

  it("narrows a fully well-formed concept", () => {
    const concept = parseConcept("---\ntype: Metric\ntags: [finance]\n---\n");

    expect(isWellFormedConcept(concept)).toBe(true);
    if (isWellFormedConcept(concept)) {
      expectTypeOf(concept).toEqualTypeOf<WellFormedOkfConcept>();
      expectTypeOf(concept.metadata.type).toEqualTypeOf<string>();
      expect(concept.metadata.type).toBe("Metric");
    }
  });

  it("only promises verification fields for typed verification inputs", () => {
    const raw = normalizeVerified([{}]);
    const valid: OkfVerification = {
      by: "human:ada",
      at: "2026-08-01T00:00:00Z"
    };
    const typed = normalizeVerified(valid);

    expectTypeOf(raw).toEqualTypeOf<Record<string, unknown>[]>();
    expectTypeOf(typed).toEqualTypeOf<OkfVerification[]>();
    expect(raw).toEqual([{}]);
    expect(typed).toEqual([valid]);
  });
});
