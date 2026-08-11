import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import type { CliDeps } from "../src/cli.js";
import { deriveTrustTier, parseConcept } from "../src/index.js";

const dogfoodBundleRoot = fileURLToPath(
  new URL("../examples/knowledge", import.meta.url)
);
const temporaryRoots: string[] = [];

interface Capture {
  deps: CliDeps;
  out: () => string;
  err: () => string;
}

function capture(overrides: Partial<CliDeps> = {}): Capture {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    deps: {
      io: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line)
      },
      now: () => new Date("2026-08-10T00:00:00Z"),
      sourceTimestamps: () => Promise.resolve(new Map<string, string>()),
      ...overrides
    },
    out: () => stdout.join("\n"),
    err: () => stderr.join("\n")
  };
}

async function makeBundle(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "okf-cli-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("okf report", () => {
  it("emits a machine-readable report an agent can act on", async () => {
    const cli = capture();
    const code = await runCli(["report", dogfoodBundleRoot, "--json"], cli.deps);

    expect(code).toBe(0);
    const report: unknown = JSON.parse(cli.out());
    expect(report).toMatchObject({
      version: "0.2",
      conceptCount: 4,
      trust: { "human-reviewed": 2, "machine-confirmed": 1, unverified: 1 },
      findings: [{ kind: "unverified", id: "references/billing-events" }]
    });
  });

  it("prints a human summary with per-kind counts", async () => {
    const root = await makeBundle();
    await writeFile(
      join(root, "revenue.md"),
      "---\ntype: Metric\ntitle: Revenue\nstale_after: 2026-01-01\n---\n# Definition\n\n[gone](missing.md)\n"
    );

    const cli = capture();
    const code = await runCli(["report", root], cli.deps);

    expect(code).toBe(0);
    expect(cli.out()).toContain("1 concepts");
    expect(cli.out()).toContain("broken-link: 1");
    expect(cli.out()).toContain("stale: 1");
    expect(cli.out()).toContain("[warning] stale revenue.md");
  });

  it("reports no findings for a clean bundle", async () => {
    const root = await makeBundle();
    await writeFile(
      join(root, "revenue.md"),
      "---\ntype: Metric\ntitle: Revenue\nverified:\n  by: human:ada\n  at: 2026-08-01T00:00:00Z\n---\n# Definition\n"
    );

    const cli = capture();
    expect(await runCli(["report", root], cli.deps)).toBe(0);
    expect(cli.out()).toContain("no findings");
  });

  it("can fail the build on warnings but ignores info findings", async () => {
    const root = await makeBundle();
    await writeFile(
      join(root, "revenue.md"),
      "---\ntype: Metric\ntitle: Revenue\n---\n# Definition\n"
    );

    const cli = capture();
    expect(await runCli(["report", root, "--fail-on-warning"], cli.deps)).toBe(0);

    await writeFile(
      join(root, "revenue.md"),
      "---\ntype: Metric\ntitle: Revenue\nstale_after: 2026-01-01\n---\n# Definition\n"
    );
    expect(await runCli(["report", root, "--fail-on-warning"], capture().deps)).toBe(1);
  });

  it("skips source resolution entirely with --no-git", async () => {
    let called = false;
    const cli = capture({
      sourceTimestamps: () => {
        called = true;
        return Promise.resolve(new Map<string, string>());
      }
    });

    expect(await runCli(["report", dogfoodBundleRoot, "--no-git"], cli.deps)).toBe(0);
    expect(called).toBe(false);
  });

  it("resolves source timestamps from git when no resolver is injected", async () => {
    const stdout: string[] = [];
    const code = await runCli(["report", dogfoodBundleRoot], {
      io: { stdout: (line) => stdout.push(line), stderr: () => undefined }
    });

    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("OKF bundle");
  });

  it("returns a failure code when the bundle cannot be read", async () => {
    const cli = capture();
    expect(await runCli(["report", join(await makeBundle(), "nope")], cli.deps)).toBe(1);
    expect(cli.err()).not.toBe("");
  });
});

describe("okf check", () => {
  it("passes a conformant bundle and reports warnings without failing", async () => {
    const cli = capture();
    expect(await runCli(["check", dogfoodBundleRoot], cli.deps)).toBe(0);
    expect(cli.out()).toContain("OKF conformant · 4 concepts");
  });

  it("fails on hard conformance errors and can emit JSON", async () => {
    const root = await makeBundle();
    await mkdir(join(root, "metrics"));
    await writeFile(join(root, "metrics", "broken.md"), "---\ntitle: No type\n---\n# X\n");

    const text = capture();
    expect(await runCli(["check", root], text.deps)).toBe(1);
    expect(text.out()).toContain("non-conformant");
    expect(text.err()).toContain("frontmatter.type.required");

    const json = capture();
    expect(await runCli(["check", root, "--json"], json.deps)).toBe(1);
    const result = JSON.parse(json.out()) as { conformant: boolean; errors: unknown[] };
    expect(result.conformant).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});

describe("okf stamp", () => {
  const conceptSource =
    "---\ntype: Reference\ntitle: Loader\nx-owner: platform\n---\n# Contract\n\nBody.\n";

  it("records process authorship while preserving extension fields", async () => {
    const root = await makeBundle();
    const file = join(root, "loader.md");
    await writeFile(file, conceptSource);

    const cli = capture();
    const code = await runCli(
      [
        "stamp",
        file,
        "--generated",
        "process:claude-code",
        "--at",
        "2026-08-10T09:00:00Z",
        "--stale-after",
        "2027-02-10"
      ],
      cli.deps
    );

    expect(code).toBe(0);
    const written = await readFile(file, "utf8");
    expect(written).toContain("by: process:claude-code");
    expect(written).toContain("at: 2026-08-10T09:00:00Z");
    expect(written).toContain("stale_after: 2027-02-10");
    expect(written).toContain("x-owner: platform");
    expect(written).toContain("# Contract");
  });

  it("refuses to stamp a human actor", async () => {
    const root = await makeBundle();
    const file = join(root, "loader.md");
    await writeFile(file, conceptSource);

    const cli = capture();
    const code = await runCli(
      ["stamp", file, "--generated", "human:felipe"],
      cli.deps
    );

    expect(code).toBe(2);
    expect(cli.err()).toContain("refuses to write human: actors");
    expect(await readFile(file, "utf8")).toBe(conceptSource);
  });

  it("rejects malformed actors and missing arguments", async () => {
    const missing = capture();
    expect(await runCli(["stamp"], missing.deps)).toBe(2);
    expect(missing.err()).toContain("requires <file>");

    const malformed = capture();
    expect(await runCli(["stamp", "x.md", "--generated", "nonsense"], malformed.deps)).toBe(2);
    expect(malformed.err()).toContain("Not a valid OKF actor");
  });

  it("previews the result without writing under --dry-run", async () => {
    const root = await makeBundle();
    const file = join(root, "loader.md");
    await writeFile(file, conceptSource);

    const cli = capture();
    const code = await runCli(
      ["stamp", file, "--generated", "process:claude-code", "--dry-run"],
      cli.deps
    );

    expect(code).toBe(0);
    expect(cli.out()).toContain("by: process:claude-code");
    expect(await readFile(file, "utf8")).toBe(conceptSource);
  });

  it("defaults the timestamp to now", async () => {
    const root = await makeBundle();
    const file = join(root, "loader.md");
    await writeFile(file, conceptSource);

    const cli = capture();
    expect(
      await runCli(["stamp", file, "--generated", "anthropic/claude"], cli.deps)
    ).toBe(0);
    expect(await readFile(file, "utf8")).toMatch(/at: \d{4}-\d{2}-\d{2}T/u);
  });
});

describe("okf stamp — replacing existing provenance", () => {
  it("replaces a previous generation stamp without disturbing other fields", async () => {
    const root = await makeBundle();
    const file = join(root, "loader.md");
    await writeFile(
      file,
      "---\ntype: Reference\ntitle: Loader\ngenerated:\n  by: process:old-pipeline\n  at: 2020-01-01T00:00:00Z\nverified:\n  by: human:ada\n  at: 2026-01-01T00:00:00Z\nstale_after: 2030-01-01\nx-owner: platform\n---\n# Contract\n\nBody.\n"
    );

    const cli = capture();
    expect(
      await runCli(
        [
          "stamp",
          file,
          "--generated",
          "process:claude-code",
          "--at",
          "2026-08-10T09:00:00Z"
        ],
        cli.deps
      )
    ).toBe(0);

    const stamped = parseConcept(await readFile(file, "utf8"));

    expect(stamped.metadata.generated).toEqual({
      by: "process:claude-code",
      at: "2026-08-10T09:00:00Z"
    });
    // A human verification already on the document is the reviewer's, not ours,
    // so stamping authorship must leave it exactly as it was. Comparing the
    // whole entry rather than just the actor matters: keeping `by` while losing
    // `at` demotes the concept from human-reviewed to unverified, because
    // deriveTrustTier requires a valid actor *and* a valid timestamp.
    expect(stamped.metadata.verified).toEqual([
      { by: "human:ada", at: "2026-01-01T00:00:00Z" }
    ]);
    expect(deriveTrustTier(stamped)).toBe("human-reviewed");
    expect(stamped.metadata.stale_after).toBe("2030-01-01");
    expect(stamped.metadata["x-owner"]).toBe("platform");
    expect(stamped.body).toContain("# Contract");
  });

  it("keeps an existing expiry when none is supplied", async () => {
    const root = await makeBundle();
    const file = join(root, "loader.md");
    await writeFile(
      file,
      "---\ntype: Reference\nstale_after: 2030-01-01\n---\n# Contract\n"
    );

    const cli = capture();
    expect(
      await runCli(["stamp", file, "--generated", "process:ci"], cli.deps)
    ).toBe(0);
    expect(await readFile(file, "utf8")).toContain("stale_after: 2030-01-01");
  });

  it("fails cleanly on a document with no frontmatter", async () => {
    const root = await makeBundle();
    const file = join(root, "plain.md");
    await writeFile(file, "# Just a heading\n\nNo frontmatter here.\n");

    const cli = capture();
    expect(
      await runCli(["stamp", file, "--generated", "process:ci"], cli.deps)
    ).toBe(1);
    expect(cli.err()).not.toBe("");
    expect(await readFile(file, "utf8")).toBe("# Just a heading\n\nNo frontmatter here.\n");
  });

  it("fails cleanly when the file does not exist", async () => {
    const cli = capture();
    expect(
      await runCli(
        ["stamp", join(await makeBundle(), "missing.md"), "--generated", "process:ci"],
        cli.deps
      )
    ).toBe(1);
    expect(cli.err()).not.toBe("");
  });
});

describe("okf on degenerate bundles", () => {
  it("reports an empty directory without crashing", async () => {
    const root = await makeBundle();
    const cli = capture();

    expect(await runCli(["report", root], cli.deps)).toBe(0);
    expect(cli.out()).toContain("0 concepts");
    expect(cli.out()).toContain("no findings");
  });

  it("passes check on a bundle whose only issues are warnings", async () => {
    const root = await makeBundle();
    await writeFile(
      join(root, "revenue.md"),
      "---\ntype: Metric\ntitle: Revenue\nverified:\n  by: not-an-actor\n  at: nonsense\n---\n# Definition\n"
    );

    const cli = capture();
    const code = await runCli(["check", root, "--json"], cli.deps);
    const result = JSON.parse(cli.out()) as {
      conformant: boolean;
      errors: unknown[];
      warnings: unknown[];
    };

    expect(code).toBe(0);
    expect(result.conformant).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("emits valid JSON for an empty bundle", async () => {
    const root = await makeBundle();
    const cli = capture();

    expect(await runCli(["report", root, "--json"], cli.deps)).toBe(0);
    expect(JSON.parse(cli.out())).toMatchObject({
      conceptCount: 0,
      findings: [],
      trust: { "human-reviewed": 0, "machine-confirmed": 0, unverified: 0 }
    });
  });
});

describe("okf usage", () => {
  it("explains itself and rejects unknown commands", async () => {
    const bare = capture();
    expect(await runCli([], bare.deps)).toBe(2);
    expect(bare.out()).toContain("Usage:");

    const help = capture();
    expect(await runCli(["help"], help.deps)).toBe(0);

    const flag = capture();
    expect(await runCli(["report", "--help"], flag.deps)).toBe(0);

    const unknown = capture();
    expect(await runCli(["frobnicate"], unknown.deps)).toBe(2);
    expect(unknown.err()).toContain("Unknown command: frobnicate");
  });
});
