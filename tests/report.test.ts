import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildReport,
  collectSourceRefs,
  lastConfirmedAt,
  parseConcept,
  resolveRelativePath,
  resolveSourcePath
} from "../src/index.js";
import type { OkfBundle, OkfRawConcept } from "../src/index.js";
import { readBundle } from "../src/node.js";

const dogfoodBundleRoot = fileURLToPath(
  new URL("../examples/knowledge", import.meta.url)
);

function concept(
  id: string,
  frontmatter: string,
  body = "# Definition\n"
): OkfRawConcept {
  return parseConcept(`---\n${frontmatter}---\n${body}`, { id, path: `${id}.md` });
}

function bundle(concepts: OkfRawConcept[], issues: OkfBundle["issues"] = []): OkfBundle {
  return { root: "/bundle", concepts, indexes: [], logs: [], issues };
}

describe("resolveRelativePath", () => {
  it("resolves bundle-relative targets and rejects external ones", () => {
    expect(resolveRelativePath("metrics/revenue", "../references/billing.md")).toBe(
      "references/billing.md"
    );
    expect(resolveRelativePath("metrics/revenue", "/src/parser.ts")).toBe(
      "src/parser.ts"
    );
    expect(resolveRelativePath("a/b", "docs\\guide.md")).toBe("a/docs/guide.md");
    expect(resolveRelativePath("a/b", "guide.md?v=1#top")).toBe("a/guide.md");

    for (const external of [
      "https://example.com/x.md",
      "//example.com/x.md",
      "#section",
      "?query",
      "",
      "../../escapes.md"
    ]) {
      expect(resolveRelativePath("a/b", external)).toBeUndefined();
    }
  });
});

describe("resolveSourcePath", () => {
  it("lets a source escape the bundle root so docs can cite sibling code", () => {
    expect(resolveSourcePath("docs/loader", "../src/node.ts")).toBe("src/node.ts");
    expect(resolveSourcePath("docs/loader", "../../src/node.ts")).toBe("../src/node.ts");
    expect(resolveSourcePath("loader", "../../src/node.ts")).toBe("../../src/node.ts");
    expect(resolveSourcePath("a/b", "https://example.com")).toBeUndefined();
  });
});

describe("collectSourceRefs", () => {
  it("resolves non-Markdown sources that the concept graph ignores", () => {
    const refs = collectSourceRefs([
      concept(
        "docs/bundle-loading",
        "type: Reference\nsources:\n  - resource: ../src/node.ts\n  - resource: https://example.com/spec\n  - resource: 42\n  - not-a-mapping\n"
      ),
      concept("docs/no-sources", "type: Guide\n"),
      parseConcept("---\ntype: Guide\nsources:\n  - resource: x.ts\n---\n")
    ]);

    expect(refs).toEqual([
      {
        id: "docs/bundle-loading",
        resource: "../src/node.ts",
        resolved: "src/node.ts",
        path: "docs/bundle-loading.md"
      }
    ]);
  });

  it("ignores a sources field that is not a list", () => {
    expect(collectSourceRefs([concept("a", "type: Guide\nsources: nope\n")])).toEqual([]);
  });
});

describe("lastConfirmedAt", () => {
  it("prefers the newest verification and falls back to generation", () => {
    expect(
      lastConfirmedAt(
        concept(
          "a",
          "type: Guide\nverified:\n  - by: process:a\n    at: 2026-01-01T00:00:00Z\n  - by: human:b\n    at: 2026-06-01T00:00:00Z\n"
        )
      )
    ).toBe("2026-06-01T00:00:00Z");

    expect(
      lastConfirmedAt(
        concept(
          "a",
          "type: Guide\nverified:\n  - by: human:b\n    at: 2026-06-01T00:00:00Z\n  - by: process:a\n    at: 2026-01-01T00:00:00Z\n"
        )
      )
    ).toBe("2026-06-01T00:00:00Z");

    expect(
      lastConfirmedAt(
        concept(
          "a",
          "type: Guide\nverified:\n  - by: process:a\n    at: nonsense\ngenerated:\n  by: process:a\n  at: 2026-02-02T00:00:00Z\n"
        )
      )
    ).toBe("2026-02-02T00:00:00Z");

    expect(lastConfirmedAt(concept("a", "type: Guide\n"))).toBeUndefined();
    expect(
      lastConfirmedAt(concept("a", "type: Guide\ngenerated:\n  by: process:a\n  at: bad\n"))
    ).toBeUndefined();
  });
});

describe("buildReport", () => {
  const now = new Date("2026-08-10T00:00:00Z");

  it("counts trust tiers and reports nothing for a healthy bundle", () => {
    const report = buildReport(
      bundle([
        concept(
          "a",
          "type: Guide\ntitle: A\nverified:\n  by: human:ada\n  at: 2026-08-01T00:00:00Z\n"
        )
      ]),
      { now }
    );

    expect(report.findings).toEqual([]);
    expect(report.trust).toEqual({
      "human-reviewed": 1,
      "machine-confirmed": 0,
      unverified: 0
    });
    expect(report.conceptCount).toBe(1);
    expect(report.version).toBeUndefined();
  });

  it("flags staleness, broken links, and unverified non-draft concepts", () => {
    const report = buildReport(
      bundle([
        concept(
          "metrics/revenue",
          "type: Metric\ntitle: Revenue\nstale_after: 2026-01-01\n",
          "# Definition\n\nSee [gone](../policies/missing.md).\n"
        ),
        concept("drafts/wip", "type: Guide\nstatus: draft\n")
      ]),
      { now }
    );

    expect(report.findings.map((finding) => finding.kind).sort()).toEqual([
      "broken-link",
      "stale",
      "unverified"
    ]);
    expect(report.trust.unverified).toBe(2);

    const stale = report.findings.find((finding) => finding.kind === "stale");
    expect(stale).toMatchObject({
      severity: "warning",
      id: "metrics/revenue",
      path: "metrics/revenue.md",
      detail: { staleAfter: "2026-01-01", status: "stable" }
    });
    expect(stale?.message).toContain("Revenue");

    expect(report.findings.find((finding) => finding.kind === "broken-link")).toMatchObject({
      id: "metrics/revenue",
      detail: { to: "policies/missing", kind: "link" }
    });
  });

  it("flags a source that changed after the concept was last confirmed", () => {
    const concepts = [
      concept(
        "docs/loader",
        "type: Reference\ntitle: Loader\nverified:\n  by: human:ada\n  at: 2026-08-01T00:00:00Z\nsources:\n  - resource: ../src/node.ts\n"
      ),
      concept(
        "docs/parser",
        "type: Reference\ntitle: Parser\nverified:\n  by: human:ada\n  at: 2026-08-01T00:00:00Z\nsources:\n  - resource: ../src/parser.ts\n"
      ),
      concept(
        "docs/unconfirmed",
        "type: Reference\nsources:\n  - resource: ../src/node.ts\n"
      )
    ];

    const report = buildReport(bundle(concepts), {
      now,
      sourceTimestamps: new Map([
        ["src/node.ts", "2026-08-09T10:00:00Z"],
        ["src/parser.ts", "2026-07-01T00:00:00Z"]
      ])
    });

    const drift = report.findings.filter((finding) => finding.kind === "source-drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      id: "docs/loader",
      path: "docs/loader.md",
      severity: "warning",
      detail: {
        resource: "../src/node.ts",
        resolved: "src/node.ts",
        sourceModified: "2026-08-09T10:00:00Z",
        confirmedAt: "2026-08-01T00:00:00Z"
      }
    });
  });

  it("carries bundle conformance issues through as findings", () => {
    const report = buildReport(
      bundle(
        [],
        [
          {
            severity: "error",
            code: "frontmatter.type.required",
            message: "Missing type.",
            path: "a.md",
            field: "type"
          },
          { severity: "warning", code: "log.date.invalid", message: "Bad date." }
        ]
      ),
      { now }
    );

    expect(report.findings).toEqual([
      {
        kind: "conformance",
        severity: "error",
        message: "frontmatter.type.required: Missing type.",
        path: "a.md",
        detail: { field: "type" }
      },
      {
        kind: "conformance",
        severity: "warning",
        message: "log.date.invalid: Bad date."
      }
    ]);
  });

  it("defaults to the current time when no clock is injected", () => {
    const report = buildReport(
      bundle([concept("a", "type: Guide\nstale_after: 2000-01-01\n")])
    );
    expect(report.findings.some((finding) => finding.kind === "stale")).toBe(true);
  });

  it("summarizes the repository dogfood bundle", async () => {
    const report = buildReport(await readBundle(dogfoodBundleRoot), { now });

    expect(report.version).toBe("0.2");
    expect(report.conceptCount).toBe(4);
    expect(report.trust).toEqual({
      "human-reviewed": 2,
      "machine-confirmed": 1,
      unverified: 1
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      kind: "unverified",
      severity: "info",
      id: "references/billing-events"
    });
  });
});
