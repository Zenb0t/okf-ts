import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { isOkfActor } from "./lifecycle.js";
import { readBundle } from "./node.js";
import { OkfParseError, parseConcept, serializeConcept } from "./parser.js";
import { buildReport, collectSourceRefs } from "./report.js";
import type { OkfFinding, OkfReport } from "./report.js";
import { isConformant } from "./validation.js";

const execFileAsync = promisify(execFile);

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface CliDeps {
  io: CliIo;
  now?: () => Date;
  /** Resolve bundle-relative source paths to last-modified ISO datetimes. */
  sourceTimestamps?: (
    root: string,
    paths: readonly string[]
  ) => Promise<ReadonlyMap<string, string>>;
}

interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Map<string, string | true>;
}

const USAGE = `okf — Open Knowledge Format tooling

Usage:
  okf report [root] [--json] [--no-git]   Work queue: conformance, staleness, links, drift
  okf check  [root] [--json]              Hard OKF conformance gate; exits 1 on errors
  okf stamp  <file> --generated <actor>   Record machine authorship on a concept
             [--at <iso>] [--stale-after <date>] [--dry-run]

okf stamp refuses to write human: actors. Human verification must come from a
reviewed commit, never from an agent stamping its own work.`;

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(name, true);
    } else {
      flags.set(name, next);
      index += 1;
    }
  }

  return { command: positionals[0], positionals: positionals.slice(1), flags };
}

function flagValue(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

async function gitTimestamps(
  root: string,
  paths: readonly string[]
): Promise<ReadonlyMap<string, string>> {
  const timestamps = new Map<string, string>();

  for (const path of paths) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["log", "-1", "--format=%cI", "--", path],
        { cwd: root }
      );
      const stamp = stdout.trim();
      if (stamp !== "") {
        timestamps.set(path, stamp);
      }
    } catch {
      // A file outside git history, or git being unavailable, simply yields no drift
      // signal. Staleness and conformance checks stay meaningful without it.
    }
  }

  return timestamps;
}

function severityRank(finding: OkfFinding): number {
  return finding.severity === "error" ? 0 : finding.severity === "warning" ? 1 : 2;
}

function formatReport(report: OkfReport): string[] {
  const lines: string[] = [];
  const counts = new Map<string, number>();
  for (const finding of report.findings) {
    counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
  }

  lines.push(`OKF bundle ${report.root}`);
  lines.push(
    `  ${String(report.conceptCount)} concepts` +
      (report.version === undefined ? "" : ` · okf ${report.version}`)
  );
  lines.push(
    `  trust: ${String(report.trust["human-reviewed"])} human-reviewed · ` +
      `${String(report.trust["machine-confirmed"])} machine-confirmed · ` +
      `${String(report.trust.unverified)} unverified`
  );

  if (report.findings.length === 0) {
    lines.push("  no findings");
    return lines;
  }

  lines.push("");
  for (const [kind, count] of [...counts].sort()) {
    lines.push(`  ${kind}: ${String(count)}`);
  }
  lines.push("");

  for (const finding of [...report.findings].sort(
    (left, right) => severityRank(left) - severityRank(right)
  )) {
    const where = finding.path ?? finding.id ?? "";
    lines.push(
      `  [${finding.severity}] ${finding.kind}${where === "" ? "" : ` ${where}`}`
    );
    lines.push(`      ${finding.message}`);
  }

  return lines;
}

async function loadReport(
  root: string,
  deps: CliDeps,
  useGit: boolean
): Promise<OkfReport> {
  const bundle = await readBundle(root);
  const resolver = deps.sourceTimestamps ?? gitTimestamps;
  const sourceTimestamps = useGit
    ? await resolver(
        bundle.root,
        [...new Set(collectSourceRefs(bundle.concepts).map((ref) => ref.resolved))]
      )
    : new Map<string, string>();

  return buildReport(bundle, {
    ...(deps.now === undefined ? {} : { now: deps.now() }),
    sourceTimestamps
  });
}

async function commandReport(args: ParsedArgs, deps: CliDeps): Promise<number> {
  const report = await loadReport(
    args.positionals[0] ?? ".",
    deps,
    args.flags.get("no-git") !== true
  );

  if (args.flags.get("json") === true) {
    deps.io.stdout(JSON.stringify(report, null, 2));
  } else {
    for (const line of formatReport(report)) {
      deps.io.stdout(line);
    }
  }

  return args.flags.get("fail-on-warning") === true &&
    report.findings.some((finding) => finding.severity !== "info")
    ? 1
    : 0;
}

async function commandCheck(args: ParsedArgs, deps: CliDeps): Promise<number> {
  const bundle = await readBundle(args.positionals[0] ?? ".");
  const conformant = isConformant(bundle.issues);
  const errors = bundle.issues.filter((issue) => issue.severity === "error");
  const warnings = bundle.issues.filter((issue) => issue.severity === "warning");

  if (args.flags.get("json") === true) {
    deps.io.stdout(
      JSON.stringify({ root: bundle.root, conformant, errors, warnings }, null, 2)
    );
  } else {
    for (const issue of [...errors, ...warnings]) {
      deps.io.stderr(
        `  [${issue.severity}] ${issue.path ?? ""} ${issue.code}: ${issue.message}`
      );
    }
    deps.io.stdout(
      conformant
        ? `OKF conformant · ${String(bundle.concepts.length)} concepts · ${String(warnings.length)} warnings`
        : `OKF non-conformant · ${String(errors.length)} errors`
    );
  }

  return conformant ? 0 : 1;
}

async function commandStamp(args: ParsedArgs, deps: CliDeps): Promise<number> {
  const file = args.positionals[0];
  const actor = flagValue(args.flags, "generated");

  if (file === undefined || actor === undefined) {
    deps.io.stderr("okf stamp requires <file> and --generated <actor>.");
    return 2;
  }
  if (actor.startsWith("human:")) {
    deps.io.stderr(
      "okf stamp refuses to write human: actors. Human verification must come from a reviewed commit."
    );
    return 2;
  }
  if (!isOkfActor(actor)) {
    deps.io.stderr(
      `Not a valid OKF actor: ${actor}. Use process:<name> or <vendor>/<tool>.`
    );
    return 2;
  }

  const concept = parseConcept(await readFile(file, "utf8"), { path: file });
  const at = flagValue(args.flags, "at") ?? new Date().toISOString();
  const metadata: Record<string, unknown> = {
    ...concept.metadata,
    generated: { by: actor, at }
  };

  const staleAfter = flagValue(args.flags, "stale-after");
  if (staleAfter !== undefined) {
    metadata.stale_after = staleAfter;
  }

  const output = serializeConcept({ metadata, body: concept.body });
  if (args.flags.get("dry-run") === true) {
    deps.io.stdout(output);
    return 0;
  }

  await writeFile(file, output, "utf8");
  deps.io.stdout(`Stamped ${file} as generated by ${actor} at ${at}.`);
  return 0;
}

export async function runCli(
  argv: readonly string[],
  deps: CliDeps
): Promise<number> {
  const args = parseArgs(argv);

  if (args.command === undefined || args.command === "help" || args.flags.get("help") === true) {
    deps.io.stdout(USAGE);
    return args.command === undefined ? 2 : 0;
  }

  try {
    switch (args.command) {
      case "report":
        return await commandReport(args, deps);
      case "check":
        return await commandCheck(args, deps);
      case "stamp":
        return await commandStamp(args, deps);
      default:
        deps.io.stderr(`Unknown command: ${args.command}`);
        deps.io.stdout(USAGE);
        return 2;
    }
  } catch (error) {
    deps.io.stderr(
      error instanceof OkfParseError || error instanceof Error
        ? error.message
        : "okf failed with an unknown error."
    );
    return 1;
  }
}
