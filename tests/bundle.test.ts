import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildGraph,
  deriveTrustTier,
  isWellFormedConcept
} from "../src/index.js";
import { readBundle } from "../src/node.js";

const temporaryRoots: string[] = [];
const dogfoodBundleRoot = fileURLToPath(
  new URL("../examples/knowledge", import.meta.url)
);

async function makeBundle(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "okf-ts-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("readBundle", () => {
  it("loads and validates the repository dogfood bundle", async () => {
    const bundle = await readBundle(dogfoodBundleRoot);

    expect(bundle.version).toBe("0.2");
    expect(bundle.issues).toEqual([]);
    expect(bundle.concepts.map((concept) => concept.id)).toEqual([
      "computations/monthly-recurring-revenue",
      "metrics/monthly-recurring-revenue",
      "policies/revenue-recognition",
      "references/billing-events"
    ]);
    expect(bundle.concepts.every(isWellFormedConcept)).toBe(true);

    const graph = buildGraph(bundle.concepts);
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toEqual([
      {
        from: "computations/monthly-recurring-revenue",
        to: "metrics/monthly-recurring-revenue",
        kind: "link",
        target: "../metrics/monthly-recurring-revenue.md",
        exists: true
      },
      {
        from: "computations/monthly-recurring-revenue",
        to: "references/billing-events",
        kind: "source",
        target: "../references/billing-events.md",
        exists: true
      },
      {
        from: "metrics/monthly-recurring-revenue",
        to: "policies/revenue-recognition",
        kind: "link",
        target: "../policies/revenue-recognition.md",
        exists: true
      },
      {
        from: "metrics/monthly-recurring-revenue",
        to: "computations/monthly-recurring-revenue",
        kind: "link",
        target: "../computations/monthly-recurring-revenue.md",
        exists: true
      },
      {
        from: "metrics/monthly-recurring-revenue",
        to: "references/billing-events",
        kind: "source",
        target: "../references/billing-events.md",
        exists: true
      },
      {
        from: "policies/revenue-recognition",
        to: "metrics/monthly-recurring-revenue",
        kind: "link",
        target: "../metrics/monthly-recurring-revenue.md",
        exists: true
      },
      {
        from: "policies/revenue-recognition",
        to: "references/billing-events",
        kind: "link",
        target: "../references/billing-events.md",
        exists: true
      },
      {
        from: "references/billing-events",
        to: "metrics/monthly-recurring-revenue",
        kind: "link",
        target: "../metrics/monthly-recurring-revenue.md",
        exists: true
      }
    ]);

    expect(
      bundle.concepts.map((concept) => ({
        id: concept.id,
        trust: deriveTrustTier(concept)
      }))
    ).toEqual([
      {
        id: "computations/monthly-recurring-revenue",
        trust: "machine-confirmed"
      },
      {
        id: "metrics/monthly-recurring-revenue",
        trust: "human-reviewed"
      },
      {
        id: "policies/revenue-recognition",
        trust: "human-reviewed"
      },
      { id: "references/billing-events", trust: "unverified" }
    ]);
  });

  it("loads a valid hierarchy and declares its root version", async () => {
    const root = await makeBundle();
    await mkdir(join(root, "metrics"));
    await writeFile(
      join(root, "index.md"),
      "---\nokf_version: \"0.2\"\n---\n# Metrics\n\n* [Revenue](metrics/revenue.md) - Revenue.\n"
    );
    await writeFile(
      join(root, "log.md"),
      "# Bundle update log\n\n## 2026-08-02\n\n* **Creation**: Added revenue.\n"
    );
    await writeFile(
      join(root, "metrics", "index.md"),
      "# Metrics\n\n* [Revenue](revenue.md) - Revenue.\n"
    );
    await writeFile(
      join(root, "metrics", "revenue.md"),
      "---\ntype: Metric\ntitle: Revenue\n---\n# Definition\n"
    );
    await writeFile(join(root, "ignored.txt"), "not part of OKF");

    const bundle = await readBundle(root);

    expect(bundle.version).toBe("0.2");
    expect(bundle.concepts.map((concept) => concept.id)).toEqual(["metrics/revenue"]);
    expect(bundle.indexes.map((document) => document.path)).toEqual([
      "index.md",
      "metrics/index.md"
    ]);
    expect(bundle.logs.map((document) => document.path)).toEqual(["log.md"]);
    expect(bundle.issues).toEqual([]);
  });

  it("collects parse and reserved-file conformance issues without aborting", async () => {
    const root = await makeBundle();
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "broken.md"), "# Missing frontmatter\n");
    await writeFile(
      join(root, "nested", "index.md"),
      "---\nokf_version: \"0.2\"\n---\nNo section heading.\n"
    );
    await writeFile(
      join(root, "nested", "log.md"),
      "# Log\n\n## August 2\n\n* Changed.\n\n## 2026-09-01\n\n* Future.\n"
    );

    const bundle = await readBundle(root);
    const codes = bundle.issues.map((issue) => issue.code);

    expect(bundle.concepts).toEqual([]);
    expect(codes).toEqual(
      expect.arrayContaining([
        "concept.parse.failed",
        "index.frontmatter.unexpected",
        "index.sections.required",
        "log.date.invalid"
      ])
    );
    expect(bundle.issues.every((issue) => issue.path !== undefined)).toBe(true);
  });

  it("reports malformed reserved frontmatter and rejects a file root", async () => {
    const root = await makeBundle();
    const file = join(root, "not-a-directory.md");
    await writeFile(file, "---\ntype: Reference\n---\n");
    await writeFile(join(root, "index.md"), "---\nokf_version: [\n---\n# Index\n");

    const bundle = await readBundle(root);

    expect(bundle.issues).toContainEqual(
      expect.objectContaining({ code: "reserved.parse.failed", path: "index.md" })
    );
    await expect(readBundle(file)).rejects.toThrow("not a directory");
  });
});
