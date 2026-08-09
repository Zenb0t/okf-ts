import { describe, expect, it } from "vitest";

import {
  OkfParseError,
  parseConcept,
  serializeConcept
} from "../src/index.js";

describe("parseConcept", () => {
  it("parses UTF-8 frontmatter, normalizes a bare verifier, and preserves extensions", () => {
    const input =
      "\uFEFF---\r\n" +
      "type: Metric\r\n" +
      "title: Revenue\r\n" +
      "stale_after: 2026-09-23\r\n" +
      "verified: { by: human:ada, at: 2026-08-01T10:00:00Z }\r\n" +
      "x-company:\r\n  owner: finance\r\n  critical: true\r\n" +
      "---\r\n" +
      "# Definition\r\n\r\nRecognized revenue.\r\n";

    const concept = parseConcept(input, {
      id: "metrics/revenue",
      path: "metrics/revenue.md"
    });

    expect(concept).toEqual({
      id: "metrics/revenue",
      path: "metrics/revenue.md",
      metadata: {
        type: "Metric",
        title: "Revenue",
        stale_after: "2026-09-23",
        verified: [{ by: "human:ada", at: "2026-08-01T10:00:00Z" }],
        "x-company": { owner: "finance", critical: true }
      },
      body: "# Definition\r\n\r\nRecognized revenue.\r\n"
    });
  });

  it("accepts the minimal conformant concept", () => {
    expect(parseConcept("---\ntype: Reference\n---\n")).toEqual({
      metadata: { type: "Reference" },
      body: ""
    });
  });

  it("parses an empty frontmatter mapping for diagnostic tooling", () => {
    expect(parseConcept("---\n---\nBody")).toEqual({
      metadata: {},
      body: "Body"
    });
  });

  it.each([
    ["missing frontmatter", "# Just markdown", "frontmatter"],
    ["an unclosed block", "---\ntype: Metric\n", "closing"],
    ["a non-mapping root", "---\n- Metric\n---\n", "mapping"],
    ["invalid YAML", "---\ntype: [\n---\n", "YAML"]
  ])("rejects %s", (_label, input, expectedMessage) => {
    expect(() => parseConcept(input)).toThrow(OkfParseError);
    expect(() => parseConcept(input)).toThrow(expectedMessage);
  });
});

describe("serializeConcept", () => {
  it("round-trips known and extension metadata without changing the body", () => {
    const concept = {
      metadata: {
        type: "Custom Domain Type",
        tags: ["one", "two"],
        verified: [{ by: "process:nightly", at: "2026-08-01T00:00:00Z" }],
        extension: { nested: [1, 2, 3] }
      },
      body: "# Details\n\nBody with --- inside it.\n"
    };

    const serialized = serializeConcept(concept);

    expect(serialized).toMatch(/^---\n/);
    expect(parseConcept(serialized)).toEqual(concept);
  });

  it("rejects non-mapping metadata supplied by untyped callers", () => {
    expect(() =>
      serializeConcept({ metadata: [] as never, body: "" })
    ).toThrow("mapping");
  });
});
