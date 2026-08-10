import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(input: string): Record<string, unknown> {
  const value: unknown = JSON.parse(input);
  if (!isRecord(value)) {
    throw new TypeError("Expected a JSON object.");
  }
  return value;
}

async function releaseRunScripts(): Promise<string[]> {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8"
  );
  const parsed: unknown = parse(workflow);
  const jobs = isRecord(parsed) ? parsed.jobs : undefined;
  const publish = isRecord(jobs) ? jobs.publish : undefined;
  const steps = isRecord(publish) ? publish.steps : undefined;
  if (!Array.isArray(steps)) {
    throw new TypeError("Expected the release workflow to define publish steps.");
  }
  return steps
    .filter(isRecord)
    .map((step) => step.run)
    .filter((run): run is string => typeof run === "string");
}

describe("published package metadata", () => {
  it("keeps the runtime dependency surface narrow", async () => {
    const packageText = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8"
    );
    const packageJson = parseJsonObject(packageText);

    expect(packageJson.dependencies).toEqual({
      marked: "^18.0.9",
      yaml: "^2.9.0"
    });
  });

  it("does not expose the implementation-specific Markdown syntax tree", async () => {
    const publicApi: Record<string, unknown> = await import("../src/index.js");

    expect(publicApi).not.toHaveProperty("parseMarkdown");
  });

  it("keeps emitted source maps usable without unpublished source files", async () => {
    const [buildConfigText, packageText] = await Promise.all([
      readFile(new URL("../tsconfig.build.json", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8")
    ]);
    const buildConfig = parseJsonObject(buildConfigText);
    const packageJson = parseJsonObject(packageText);
    const compilerOptions = buildConfig.compilerOptions;
    const files = packageJson.files;
    const embedsSources =
      isRecord(compilerOptions) && compilerOptions.inlineSources === true;
    const emitsDeclarationMaps =
      isRecord(compilerOptions) && compilerOptions.declarationMap === true;
    const publishesSources = Array.isArray(files) && files.includes("src");

    expect(
      publishesSources || (embedsSources && !emitsDeclarationMaps)
    ).toBe(true);
  });
});

describe("release workflow", () => {
  it("publishes with an explicit dist-tag rather than defaulting to latest", async () => {
    const publish = (await releaseRunScripts()).find((script) =>
      script.includes("npm publish")
    );

    expect(publish).toBeDefined();
    expect(publish).toContain("--tag");
  });

  it("routes semver prereleases away from the latest dist-tag", async () => {
    const selection = (await releaseRunScripts()).find((script) =>
      script.includes("dist_tag=")
    );
    const prerelease = /\*-\*\)\s*dist_tag=([\w.-]+)/u.exec(selection ?? "");

    expect(prerelease?.[1]).toBeDefined();
    expect(prerelease?.[1]).not.toBe("latest");
  });
});
