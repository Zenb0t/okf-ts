import { readdir, readFile, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

import { OkfParseError, parseConcept, parseDocumentParts } from "./parser.js";
import type {
  OkfBundle,
  OkfIssue,
  OkfReservedDocument,
  ReservedDocumentKind
} from "./types.js";
import { validateBundle } from "./validation.js";

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

async function markdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path);
      }
    }
  }

  await walk(root);
  return files;
}

function parseFailure(path: string, error: unknown, kind: "concept" | "reserved"): OkfIssue {
  return {
    severity: "error",
    code: `${kind}.parse.failed`,
    message: error instanceof Error ? error.message : "Document could not be parsed.",
    path
  };
}

function reservedDocument(
  content: string,
  path: string,
  kind: ReservedDocumentKind
): OkfReservedDocument {
  const parts = parseDocumentParts(content, { required: false });
  return {
    kind,
    path,
    body: parts.body,
    ...(parts.metadata === undefined ? {} : { metadata: parts.metadata })
  };
}

export async function readBundle(root: string): Promise<OkfBundle> {
  const absoluteRoot = resolve(root);
  const rootStat = await stat(absoluteRoot);
  if (!rootStat.isDirectory()) {
    throw new TypeError(`OKF bundle root is not a directory: ${absoluteRoot}`);
  }

  const concepts: OkfBundle["concepts"] = [];
  const indexes: OkfReservedDocument[] = [];
  const logs: OkfReservedDocument[] = [];
  const issues: OkfIssue[] = [];

  for (const file of await markdownFiles(absoluteRoot)) {
    const path = portablePath(relative(absoluteRoot, file));
    const name = basename(file);
    const content = await readFile(file, "utf8");

    try {
      if (name === "index.md" || name === "log.md") {
        const kind = name === "index.md" ? "index" : "log";
        const document = reservedDocument(content, path, kind);
        (kind === "index" ? indexes : logs).push(document);
      } else {
        concepts.push(
          parseConcept(content, {
            id: path.slice(0, -3),
            path
          })
        );
      }
    } catch (error) {
      if (!(error instanceof OkfParseError)) {
        throw error;
      }
      issues.push(parseFailure(path, error, name === "index.md" || name === "log.md" ? "reserved" : "concept"));
    }
  }

  const rootIndex = indexes.find((document) => document.path === "index.md");
  const declaredVersion = rootIndex?.metadata?.okf_version;
  const bundle: OkfBundle = {
    root: absoluteRoot,
    concepts,
    indexes,
    logs,
    issues
  };
  if (typeof declaredVersion === "string") {
    bundle.version = declaredVersion;
  }
  bundle.issues.push(...validateBundle(bundle));
  return bundle;
}
