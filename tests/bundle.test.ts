import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readBundle } from "../src/node.js";

const temporaryRoots: string[] = [];

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
