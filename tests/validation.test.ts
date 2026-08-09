import { describe, expect, it } from "vitest";

import {
  isConformant,
  parseConcept,
  validateConcept,
  validateReservedDocument
} from "../src/index.js";

describe("validateConcept", () => {
  it("accepts a concept with only a non-empty type", () => {
    expect(validateConcept(parseConcept("---\ntype: Reference\n---\n"))).toEqual([]);
  });

  it("reports the only hard concept conformance rule as an error", () => {
    const concept = parseConcept("---\ntitle: Missing type\n---\n");

    expect(validateConcept(concept)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "frontmatter.type.required"
      })
    );
  });

  it("does not reject unknown types or extension fields", () => {
    const concept = parseConcept(
      "---\ntype: Internal Widget\nx-company-policy: strict\n---\n"
    );

    expect(validateConcept(concept)).toEqual([]);
  });

  it("surfaces malformed optional families as soft-guidance warnings", () => {
    const concept = parseConcept(`---
type: Attested Computation
status: retired
stale_after: next-week
generated: { at: yesterday }
verified: [{ by: process:nightly }]
sources:
  - id: duplicate
  - { id: duplicate, resource: policy.md }
parameters: [{ name: year, required: yes }]
---
`);

    const issues = validateConcept(concept);
    const codes = issues.map((issue) => issue.code);

    expect(issues.every((issue) => issue.severity === "warning")).toBe(true);
    expect(codes).toEqual(
      expect.arrayContaining([
        "frontmatter.status.invalid",
        "frontmatter.stale_after.invalid",
        "frontmatter.generated.by.required",
        "frontmatter.generated.at.invalid",
        "frontmatter.verified.at.required",
        "frontmatter.source.resource.required",
        "frontmatter.source.id.duplicate",
        "frontmatter.attested.runtime.required",
        "frontmatter.parameter.type.required",
        "frontmatter.parameter.required.invalid"
      ])
    );
  });

  it("accepts every v0.2 frontmatter family together", () => {
    const concept = parseConcept(`---
type: Attested Computation
title: Revenue for fiscal year
description: Recognized revenue for a fiscal year.
resource: /metrics/revenue
tags: [finance, revenue]
status: stable
runtime: bigquery
parameters:
  - { name: year, type: integer, required: true }
executor:
  resource: references/run.md
  receipt: [job_id, executed_sql, result]
attester:
  resource: references/attest.ts
generated: { by: reference-agent/v1, at: 2026-08-01T10:00:00Z }
verified:
  - { by: human:ada, at: 2026-08-02T10:00:00Z }
stale_after: 2026-12-31
sources:
  - id: policy
    resource: https://example.com/policy
    title: Revenue policy
    author: team:finance
    usage_count: 1200
    last_modified: 2026-07-31
usage_window: { from: 2026-07-01, to: 2026-07-31 }
x-company: { owner: finance }
---
# Computation

~~~sql
select @year
~~~
`);

    expect(validateConcept(concept)).toEqual([]);
  });

  it("reports malformed scalar, source, and date-range shapes", () => {
    const concept = parseConcept(`---
type: Metric
title: 42
description: ""
resource: []
tags: [valid, ""]
usage_window: soon
sources:
  - invalid
  - resource: policy.md
    id: ""
    title: 9
    author: []
    usage_count: -1
    last_modified: last-week
    usage_window: { from: 2026-02-30 }
---
`);

    const codes = validateConcept(concept).map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "frontmatter.title.invalid",
        "frontmatter.description.invalid",
        "frontmatter.resource.invalid",
        "frontmatter.tags.invalid",
        "usage_window.invalid",
        "frontmatter.source.invalid",
        "frontmatter.source.id.invalid",
        "frontmatter.source.title.invalid",
        "frontmatter.source.author.invalid",
        "frontmatter.source.usage_count.invalid",
        "frontmatter.source.last_modified.invalid",
        "sources[1].usage_window.from.invalid",
        "sources[1].usage_window.to.invalid"
      ])
    );
  });

  it("reports malformed trust and computation container shapes", () => {
    const malformedDocuments = [
      `---
type: Metric
sources: invalid
generated: agent
verified: human:ada
runtime: 42
parameters: year
executor: run
attester: attest
---
`,
      `---
type: Attested Computation
verified: [{ at: invalid-date }]
parameters: [invalid]
executor: { resource: "", receipt: invalid }
attester: { resource: "" }
---
`
    ];

    const codes = malformedDocuments.flatMap((document) =>
      validateConcept(parseConcept(document)).map((issue) => issue.code)
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "frontmatter.sources.invalid",
        "frontmatter.generated.invalid",
        "frontmatter.verified.invalid",
        "frontmatter.runtime.invalid",
        "frontmatter.parameters.invalid",
        "frontmatter.executor.invalid",
        "frontmatter.attester.invalid",
        "frontmatter.verified.by.required",
        "frontmatter.verified.at.invalid",
        "frontmatter.parameter.invalid",
        "frontmatter.executor.resource.invalid",
        "frontmatter.executor.receipt.invalid",
        "frontmatter.attester.resource.invalid"
      ])
    );
  });

  it("reports non-mapping verification entries without dropping valid events", () => {
    const concept = parseConcept(`---
type: Metric
verified:
  - invalid
  - { by: human:ada, at: 2026-08-01T00:00:00Z }
---
`);

    expect(validateConcept(concept)).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "frontmatter.verification.invalid",
        field: "verified[0]"
      })
    ]);
  });

  it("warns about impossible datetimes and malformed actor identifiers", () => {
    const concept = parseConcept(`---
type: Metric
generated: { by: robot, at: 2026-02-30T00:00:00Z }
verified:
  - { by: ada, at: 2026-02-30T00:00:00Z }
---
`);

    expect(validateConcept(concept).map((issue) => issue.code)).toEqual([
      "frontmatter.generated.by.invalid",
      "frontmatter.generated.at.invalid",
      "frontmatter.verified.by.invalid",
      "frontmatter.verified.at.invalid"
    ]);
  });

  it("validates both representations of an attested computation", () => {
    const issuesFor = (frontmatter: string, body = ""): string[] =>
      validateConcept(
        parseConcept(`---
type: Attested Computation
runtime: bigquery
${frontmatter}---
${body}`)
      ).map((issue) => issue.code);

    expect(issuesFor("")).toContain(
      "frontmatter.attested.computation.required"
    );
    expect(issuesFor("computation: 42\n")).toContain(
      "frontmatter.computation.invalid"
    );
    expect(issuesFor("computation: references/revenue.sql\n")).toEqual([]);
    expect(
      issuesFor("", "# Computation\n\n~~~sql\nselect 1\n~~~\n")
    ).toEqual([]);
    expect(
      issuesFor("", "# Computation\n\n    select 1\n")
    ).toEqual([]);
    expect(
      issuesFor(
        "",
        "# Computation\n\nNo code here.\n\n# Examples\n\n~~~sql\nselect 1\n~~~\n"
      )
    ).toContain("frontmatter.attested.computation.required");
    expect(
      issuesFor(
        "computation: references/revenue.sql\n",
        "# Computation\n\n~~~sql\nselect 1\n~~~\n"
      )
    ).toContain("frontmatter.attested.computation.conflict");
    expect(
      issuesFor(
        "",
        "# Computation\n\n~~~sql\nselect 1\n~~~\n\n~~~sql\nselect 2\n~~~\n"
      )
    ).toContain("frontmatter.attested.computation.multiple");
  });
});

describe("reserved document validation", () => {
  it("checks log frontmatter, date headings, and newest-first ordering", () => {
    const noEntries = validateReservedDocument({
      kind: "log",
      path: "log.md",
      metadata: { unexpected: true },
      body: "# Log\n"
    });
    const outOfOrder = validateReservedDocument({
      kind: "log",
      path: "log.md",
      body: "# Log\n\n## 2026-08-01\n\n* First.\n\n## 2026-08-02\n\n* Second.\n"
    });

    expect(noEntries.map((issue) => issue.code)).toEqual([
      "log.frontmatter.unexpected",
      "log.entries.required"
    ]);
    expect(outOfOrder).toContainEqual(
      expect.objectContaining({ code: "log.order.invalid" })
    );
    expect(isConformant(noEntries)).toBe(false);
    expect(isConformant([])).toBe(true);
  });
});
