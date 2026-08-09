import { parseDocument, stringify } from "yaml";

import type {
  OkfConcept,
  OkfMetadata,
  ParseConceptOptions
} from "./types.js";

export class OkfParseError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OkfParseError";
  }
}

interface DocumentParts {
  metadata?: Record<string, unknown>;
  body: string;
}

function removeBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseYamlMapping(yaml: string): Record<string, unknown> {
  const document = parseDocument(yaml, {
    schema: "core"
  });

  if (document.errors.length > 0) {
    const [firstError] = document.errors;
    throw new OkfParseError(`Invalid YAML frontmatter: ${firstError?.message ?? "unknown error"}`, {
      cause: firstError
    });
  }

  const value: unknown = document.toJS({ maxAliasCount: 100 });
  if (value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new OkfParseError("YAML frontmatter must contain a mapping at its root.");
  }
  return value;
}

export function parseDocumentParts(
  input: string,
  options: { required: boolean }
): DocumentParts {
  const source = removeBom(input);
  const opening = /^---[ \t]*(?:\r?\n|$)/.exec(source);

  if (opening === null) {
    if (options.required) {
      throw new OkfParseError("Document must begin with a YAML frontmatter block.");
    }
    return { body: source };
  }

  const remainder = source.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(remainder);
  if (closing === null) {
    throw new OkfParseError("YAML frontmatter is missing its closing delimiter.");
  }

  const yaml = remainder.slice(0, closing.index);
  const body = remainder.slice(closing.index + closing[0].length);
  return { metadata: parseYamlMapping(yaml), body };
}

function normalizeKnownFields(metadata: Record<string, unknown>): OkfMetadata {
  const verified = metadata.verified;
  if (isRecord(verified)) {
    return { ...metadata, verified: [verified] } as OkfMetadata;
  }
  return metadata;
}

export function parseConcept(
  input: string,
  options: ParseConceptOptions = {}
): OkfConcept {
  const { metadata, body } = parseDocumentParts(input, { required: true });
  const concept: OkfConcept = {
    metadata: normalizeKnownFields(metadata ?? {}),
    body
  };

  if (options.id !== undefined) {
    concept.id = options.id;
  }
  if (options.path !== undefined) {
    concept.path = options.path;
  }
  return concept;
}

export function serializeConcept(concept: Pick<OkfConcept, "metadata" | "body">): string {
  if (!isRecord(concept.metadata)) {
    throw new TypeError("Concept metadata must be a mapping.");
  }

  const yaml = stringify(concept.metadata, {
    indent: 2,
    lineWidth: 0,
    schema: "core"
  });
  return `---\n${yaml}---\n${concept.body}`;
}
