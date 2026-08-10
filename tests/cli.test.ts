import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import type { CliDeps } from "../src/cli.js";

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
