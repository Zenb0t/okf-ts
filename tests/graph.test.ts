import { describe, expect, it } from "vitest";

import { buildGraph, type OkfConcept } from "../src/index.js";

describe("buildGraph", () => {
  it("builds directed concept edges from Markdown links and internal sources", () => {
    const concepts: OkfConcept[] = [
      {
        id: "metrics/revenue",
        path: "metrics/revenue.md",
        metadata: {
          type: "Metric",
          sources: [{ resource: "../policies/revenue.md" }]
        },
        body: [
          "See [customers](/tables/customers.md).",
          "Use [the computation](../computations/revenue.md#computation).",
          "A [missing concept](../tables/missing.md) is tolerated.",
          "External [documentation](https://example.com/docs) is ignored.",
          "![diagram](../tables/not-a-link.md)",
          "",
          "```md",
          "[code sample](../tables/not-a-link.md)",
          "```"
        ].join("\n")
      },
      {
        id: "tables/customers",
        path: "tables/customers.md",
        metadata: { type: "Table" },
        body: ""
      },
      {
        id: "computations/revenue",
        path: "computations/revenue.md",
        metadata: { type: "Attested Computation", runtime: "bigquery" },
        body: ""
      },
      {
        id: "policies/revenue",
        path: "policies/revenue.md",
        metadata: { type: "Policy" },
        body: ""
      }
    ];

    const graph = buildGraph(concepts);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "metrics/revenue",
      "tables/customers",
      "computations/revenue",
      "policies/revenue"
    ]);
    expect(graph.edges).toEqual([
      {
        from: "metrics/revenue",
        to: "tables/customers",
        kind: "link",
        target: "/tables/customers.md",
        exists: true
      },
      {
        from: "metrics/revenue",
        to: "computations/revenue",
        kind: "link",
        target: "../computations/revenue.md#computation",
        exists: true
      },
      {
        from: "metrics/revenue",
        to: "tables/missing",
        kind: "link",
        target: "../tables/missing.md",
        exists: false
      },
      {
        from: "metrics/revenue",
        to: "policies/revenue",
        kind: "source",
        target: "../policies/revenue.md",
        exists: true
      }
    ]);
  });

  it("requires stable concept IDs and ignores paths that escape the bundle", () => {
    const concepts: OkfConcept[] = [
      {
        metadata: { type: "Metric" },
        body: "[outside](../../outside.md)"
      },
      {
        id: "root",
        metadata: { type: "Metric", sources: "invalid" as never },
        body: [
          "[known](./known.md)",
          "[escape](../outside.md)",
          "[not markdown](notes.txt)",
          "[query](?page=1)",
          "[protocol](mailto:ada@example.com)"
        ].join("\n")
      },
      {
        id: "known",
        metadata: { type: "Reference" },
        body: ""
      }
    ];

    expect(buildGraph(concepts)).toEqual({
      nodes: [
        { id: "root", concept: concepts[1] },
        { id: "known", concept: concepts[2] }
      ],
      edges: [
        {
          from: "root",
          to: "known",
          kind: "link",
          target: "./known.md",
          exists: true
        }
      ]
    });
  });
});
