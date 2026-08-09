import {
  countMarkdownCodeBlocksUnderHeading,
  extractMarkdownHeadings
} from "./markdown.js";
import { isIsoDate, isIsoDateTime, isOkfActor } from "./lifecycle.js";
import type {
  OkfBundle,
  OkfIssue,
  OkfRawConcept,
  OkfReservedDocument,
  WellFormedOkfConcept
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function warning(
  issues: OkfIssue[],
  code: string,
  message: string,
  concept: OkfRawConcept,
  field: string
): void {
  issues.push({
    severity: "warning",
    code,
    message,
    ...(concept.path === undefined ? {} : { path: concept.path }),
    field
  });
}

function validateDateRange(
  value: unknown,
  issues: OkfIssue[],
  concept: OkfRawConcept,
  field: string
): void {
  if (!isRecord(value)) {
    warning(issues, `${field}.invalid`, `${field} must be a date-range mapping.`, concept, field);
    return;
  }
  for (const key of ["from", "to"] as const) {
    if (!isIsoDate(value[key])) {
      warning(
        issues,
        `${field}.${key}.invalid`,
        `${field}.${key} must be an ISO 8601 date (YYYY-MM-DD).`,
        concept,
        `${field}.${key}`
      );
    }
  }
}

function validateSources(
  metadata: Record<string, unknown>,
  issues: OkfIssue[],
  concept: OkfRawConcept
): void {
  if (metadata.sources === undefined) {
    return;
  }
  if (!Array.isArray(metadata.sources)) {
    warning(issues, "frontmatter.sources.invalid", "sources must be a list.", concept, "sources");
    return;
  }

  const ids = new Set<string>();
  metadata.sources.forEach((source, index) => {
    const field = `sources[${String(index)}]`;
    if (!isRecord(source)) {
      warning(issues, "frontmatter.source.invalid", "Each source must be a mapping.", concept, field);
      return;
    }
    if (!isNonEmptyString(source.resource)) {
      warning(
        issues,
        "frontmatter.source.resource.required",
        "Each source must have a non-empty resource.",
        concept,
        `${field}.resource`
      );
    }
    if (source.id !== undefined) {
      if (!isNonEmptyString(source.id)) {
        warning(issues, "frontmatter.source.id.invalid", "Source id must be non-empty.", concept, `${field}.id`);
      } else if (ids.has(source.id)) {
        warning(
          issues,
          "frontmatter.source.id.duplicate",
          `Source id '${source.id}' is duplicated.`,
          concept,
          `${field}.id`
        );
      } else {
        ids.add(source.id);
      }
    }
    for (const key of ["title", "author"] as const) {
      if (source[key] !== undefined && !isNonEmptyString(source[key])) {
        warning(
          issues,
          `frontmatter.source.${key}.invalid`,
          `Source ${key} must be a non-empty string when present.`,
          concept,
          `${field}.${key}`
        );
      }
    }
    if (
      source.usage_count !== undefined &&
      (typeof source.usage_count !== "number" ||
        !Number.isInteger(source.usage_count) ||
        source.usage_count < 0)
    ) {
      warning(
        issues,
        "frontmatter.source.usage_count.invalid",
        "Source usage_count must be a non-negative integer.",
        concept,
        `${field}.usage_count`
      );
    }
    if (source.last_modified !== undefined && !isIsoDate(source.last_modified)) {
      warning(
        issues,
        "frontmatter.source.last_modified.invalid",
        "Source last_modified must be an ISO 8601 date (YYYY-MM-DD).",
        concept,
        `${field}.last_modified`
      );
    }
    if (source.usage_window !== undefined) {
      validateDateRange(source.usage_window, issues, concept, `${field}.usage_window`);
    }
  });
}

function validateTrust(
  metadata: Record<string, unknown>,
  issues: OkfIssue[],
  concept: OkfRawConcept
): void {
  if (metadata.generated !== undefined) {
    if (!isRecord(metadata.generated)) {
      warning(issues, "frontmatter.generated.invalid", "generated must be a mapping.", concept, "generated");
    } else {
      if (!isNonEmptyString(metadata.generated.by)) {
        warning(
          issues,
          "frontmatter.generated.by.required",
          "generated.by must identify an actor.",
          concept,
          "generated.by"
        );
      } else if (!isOkfActor(metadata.generated.by)) {
        warning(
          issues,
          "frontmatter.generated.by.invalid",
          "generated.by must follow the OKF actor convention.",
          concept,
          "generated.by"
        );
      }
      if (metadata.generated.at !== undefined && !isIsoDateTime(metadata.generated.at)) {
        warning(
          issues,
          "frontmatter.generated.at.invalid",
          "generated.at must be an ISO 8601 datetime.",
          concept,
          "generated.at"
        );
      }
    }
  }

  if (metadata.verified !== undefined) {
    const raw = metadata.verified;
    if (!isRecord(raw) && !Array.isArray(raw)) {
      warning(issues, "frontmatter.verified.invalid", "verified must be a mapping or list.", concept, "verified");
      return;
    }
    const verifications: unknown[] = Array.isArray(raw) ? raw : [raw];
    verifications.forEach((verification, index) => {
      const field = `verified[${String(index)}]`;
      if (!isRecord(verification)) {
        warning(
          issues,
          "frontmatter.verification.invalid",
          "Each verification must be a mapping.",
          concept,
          field
        );
        return;
      }
      if (!isNonEmptyString(verification.by)) {
        warning(
          issues,
          "frontmatter.verified.by.required",
          "Verification by must identify an actor.",
          concept,
          `${field}.by`
        );
      } else if (!isOkfActor(verification.by)) {
        warning(
          issues,
          "frontmatter.verified.by.invalid",
          "Verification by must follow the OKF actor convention.",
          concept,
          `${field}.by`
        );
      }
      if (!isNonEmptyString(verification.at)) {
        warning(
          issues,
          "frontmatter.verified.at.required",
          "Verification at is required.",
          concept,
          `${field}.at`
        );
      } else if (!isIsoDateTime(verification.at)) {
        warning(
          issues,
          "frontmatter.verified.at.invalid",
          "Verification at must be an ISO 8601 datetime.",
          concept,
          `${field}.at`
        );
      }
    });
  }
}

function validateComputation(
  metadata: Record<string, unknown>,
  issues: OkfIssue[],
  concept: OkfRawConcept
): void {
  const isAttested = metadata.type === "Attested Computation";
  if (isAttested && !isNonEmptyString(metadata.runtime)) {
    warning(
      issues,
      "frontmatter.attested.runtime.required",
      "Attested Computation concepts should declare a runtime.",
      concept,
      "runtime"
    );
  } else if (metadata.runtime !== undefined && !isNonEmptyString(metadata.runtime)) {
    warning(
      issues,
      "frontmatter.runtime.invalid",
      "runtime must be a non-empty string when present.",
      concept,
      "runtime"
    );
  }

  const computation = metadata.computation;
  const hasComputationPath = isNonEmptyString(computation);
  if (computation !== undefined && !hasComputationPath) {
    warning(
      issues,
      "frontmatter.computation.invalid",
      "computation must be a non-empty path when present.",
      concept,
      "computation"
    );
  }

  if (isAttested) {
    const inlineBlocks = countMarkdownCodeBlocksUnderHeading(
      concept.body,
      "Computation"
    );
    if (hasComputationPath && inlineBlocks > 0) {
      warning(
        issues,
        "frontmatter.attested.computation.conflict",
        "Use either a computation path or an inline computation code block, not both.",
        concept,
        "computation"
      );
    } else if (computation === undefined && inlineBlocks === 0) {
      warning(
        issues,
        "frontmatter.attested.computation.required",
        "An Attested Computation should provide a computation path or an inline code block.",
        concept,
        "computation"
      );
    }
    if (inlineBlocks > 1) {
      warning(
        issues,
        "frontmatter.attested.computation.multiple",
        "An inline Attested Computation should contain exactly one code block.",
        concept,
        "computation"
      );
    }
  }

  if (metadata.parameters !== undefined) {
    if (!Array.isArray(metadata.parameters)) {
      warning(issues, "frontmatter.parameters.invalid", "parameters must be a list.", concept, "parameters");
    } else {
      metadata.parameters.forEach((parameter, index) => {
        const field = `parameters[${String(index)}]`;
        if (!isRecord(parameter)) {
          warning(issues, "frontmatter.parameter.invalid", "Each parameter must be a mapping.", concept, field);
          return;
        }
        for (const key of ["name", "type"] as const) {
          if (!isNonEmptyString(parameter[key])) {
            warning(
              issues,
              `frontmatter.parameter.${key}.required`,
              `Parameter ${key} must be a non-empty string.`,
              concept,
              `${field}.${key}`
            );
          }
        }
        if (typeof parameter.required !== "boolean") {
          warning(
            issues,
            "frontmatter.parameter.required.invalid",
            "Parameter required must be boolean.",
            concept,
            `${field}.required`
          );
        }
      });
    }
  }

  for (const key of ["executor", "attester"] as const) {
    const value = metadata[key];
    if (value !== undefined && !isRecord(value)) {
      warning(issues, `frontmatter.${key}.invalid`, `${key} must be a mapping.`, concept, key);
    } else if (isRecord(value) && value.resource !== undefined && !isNonEmptyString(value.resource)) {
      warning(
        issues,
        `frontmatter.${key}.resource.invalid`,
        `${key}.resource must be a non-empty path or URI.`,
        concept,
        `${key}.resource`
      );
    }
  }

  const receipt = isRecord(metadata.executor) ? metadata.executor.receipt : undefined;
  if (
    receipt !== undefined &&
    (!Array.isArray(receipt) || !receipt.every(isNonEmptyString))
  ) {
    warning(
      issues,
      "frontmatter.executor.receipt.invalid",
      "executor.receipt must be a list of non-empty field names.",
      concept,
      "executor.receipt"
    );
  }
}

export function validateConcept(concept: OkfRawConcept): OkfIssue[] {
  const issues: OkfIssue[] = [];
  const metadata: Record<string, unknown> = concept.metadata;

  if (!isNonEmptyString(metadata.type)) {
    issues.push({
      severity: "error",
      code: "frontmatter.type.required",
      message: "Concept frontmatter must contain a non-empty type.",
      ...(concept.path === undefined ? {} : { path: concept.path }),
      field: "type"
    });
  }

  for (const field of ["title", "description", "resource"] as const) {
    if (metadata[field] !== undefined && !isNonEmptyString(metadata[field])) {
      warning(
        issues,
        `frontmatter.${field}.invalid`,
        `${field} must be a non-empty string when present.`,
        concept,
        field
      );
    }
  }
  if (
    metadata.tags !== undefined &&
    (!Array.isArray(metadata.tags) || !metadata.tags.every(isNonEmptyString))
  ) {
    warning(issues, "frontmatter.tags.invalid", "tags must be a list of non-empty strings.", concept, "tags");
  }
  if (
    metadata.status !== undefined &&
    metadata.status !== "draft" &&
    metadata.status !== "stable" &&
    metadata.status !== "deprecated"
  ) {
    warning(
      issues,
      "frontmatter.status.invalid",
      "status must be draft, stable, or deprecated.",
      concept,
      "status"
    );
  }
  if (metadata.stale_after !== undefined && !isIsoDate(metadata.stale_after)) {
    warning(
      issues,
      "frontmatter.stale_after.invalid",
      "stale_after must be an ISO 8601 date (YYYY-MM-DD).",
      concept,
      "stale_after"
    );
  }
  if (metadata.usage_window !== undefined) {
    validateDateRange(metadata.usage_window, issues, concept, "usage_window");
  }

  validateSources(metadata, issues, concept);
  validateTrust(metadata, issues, concept);
  validateComputation(metadata, issues, concept);
  return issues;
}

export function isWellFormedConcept(
  concept: OkfRawConcept
): concept is WellFormedOkfConcept {
  return validateConcept(concept).length === 0;
}

function reservedIssue(
  document: OkfReservedDocument,
  code: string,
  message: string,
  field?: string
): OkfIssue {
  return {
    severity: "error",
    code,
    message,
    path: document.path,
    ...(field === undefined ? {} : { field })
  };
}

export function validateReservedDocument(document: OkfReservedDocument): OkfIssue[] {
  const issues: OkfIssue[] = [];
  const headings = extractMarkdownHeadings(document.body);

  if (document.kind === "index") {
    if (document.path !== "index.md" && document.metadata !== undefined) {
      issues.push(
        reservedIssue(
          document,
          "index.frontmatter.unexpected",
          "Only the bundle-root index.md may contain frontmatter."
        )
      );
    }
    if (headings.length === 0) {
      issues.push(
        reservedIssue(
          document,
          "index.sections.required",
          "An index.md must contain at least one section heading."
        )
      );
    }
    return issues;
  }

  if (document.metadata !== undefined) {
    issues.push(
      reservedIssue(document, "log.frontmatter.unexpected", "A log.md must not contain frontmatter.")
    );
  }
  const dateHeadings = headings.filter((heading) => heading.depth === 2);
  if (dateHeadings.length === 0) {
    issues.push(
      reservedIssue(
        document,
        "log.entries.required",
        "A log.md must contain at least one level-two date heading."
      )
    );
    return issues;
  }

  const validDates: string[] = [];
  for (const heading of dateHeadings) {
    if (!isIsoDate(heading.text)) {
      issues.push(
        reservedIssue(
          document,
          "log.date.invalid",
          `Log heading '${heading.text}' must use YYYY-MM-DD.`,
          heading.text
        )
      );
    } else {
      validDates.push(heading.text);
    }
  }
  if (
    validDates.some((date, index) => {
      const previous = validDates[index - 1];
      return previous !== undefined && date > previous;
    })
  ) {
    issues.push(
      reservedIssue(
        document,
        "log.order.invalid",
        "Log date headings must be ordered newest first."
      )
    );
  }
  return issues;
}

export function validateBundle(bundle: Pick<OkfBundle, "concepts" | "indexes" | "logs">): OkfIssue[] {
  return [
    ...bundle.concepts.flatMap(validateConcept),
    ...bundle.indexes.flatMap(validateReservedDocument),
    ...bundle.logs.flatMap(validateReservedDocument)
  ];
}

export function isConformant(issues: readonly OkfIssue[]): boolean {
  return issues.every((issue) => issue.severity !== "error");
}
