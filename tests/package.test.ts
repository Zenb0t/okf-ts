import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

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
