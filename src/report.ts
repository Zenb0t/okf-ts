import { buildGraph } from "./graph.js";
import {
  deriveTrustTier,
  getStatus,
  isIsoDateTime,
  isStale,
  normalizeVerified
} from "./lifecycle.js";
import { resolveSourcePath } from "./paths.js";
import type { OkfBundle, OkfRawConcept, TrustTier } from "./types.js";

export type OkfFindingKind =
  | "conformance"
  | "stale"
  | "broken-link"
  | "source-drift"
  | "unverified";

export type OkfFindingSeverity = "error" | "warning" | "info";

export interface OkfFinding {
  kind: OkfFindingKind;
  severity: OkfFindingSeverity;
  message: string;
  id?: string;
  path?: string;
  detail?: Record<string, unknown>;
}

export interface OkfReport {
  root: string;
  version?: string;
  conceptCount: number;
  trust: Record<TrustTier, number>;
  findings: OkfFinding[];
}

/** A `sources[].resource` target resolved to a bundle-relative path. */
export interface OkfSourceRef {
  id: string;
  resource: string;
  resolved: string;
  path?: string;
}

export interface BuildReportOptions {
  now?: Date;
  /** Bundle-relative source path to last-modified ISO datetime, usually from git. */
  sourceTimestamps?: ReadonlyMap<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEpoch(value: unknown): number | undefined {
  if (typeof value !== "string" || !isIsoDateTime(value)) {
    return undefined;
  }
  const epoch = Date.parse(value);
  return Number.isNaN(epoch) ? undefined : epoch;
}

/**
 * Collect every `sources[].resource` that points at a file. Unlike the concept graph
 * these targets are neither restricted to Markdown nor to the bundle root, because
 * codebase docs cite the code they describe and that code usually sits beside the
 * documentation bundle rather than inside it.
 */
export function collectSourceRefs(
  concepts: readonly OkfRawConcept[]
): OkfSourceRef[] {
  const refs: OkfSourceRef[] = [];

  for (const concept of concepts) {
    const { id } = concept;
    const sources = concept.metadata.sources;
    if (id === undefined || !Array.isArray(sources)) {
      continue;
    }

    for (const source of sources) {
      if (!isRecord(source)) {
        continue;
      }
      const { resource } = source;
      if (typeof resource !== "string") {
        continue;
      }
      const resolved = resolveSourcePath(id, resource);
      if (resolved === undefined) {
        continue;
      }
      refs.push({
        id,
        resource,
        resolved,
        ...(concept.path === undefined ? {} : { path: concept.path })
      });
    }
  }

  return refs;
}

/**
 * The most recent moment a human or process stood behind this concept: the latest
 * `verified.at`, falling back to `generated.at`.
 */
export function lastConfirmedAt(concept: OkfRawConcept): string | undefined {
  const verifications = normalizeVerified(concept.metadata.verified)
    .map((entry) => entry.at)
    .filter((at): at is string => toEpoch(at) !== undefined);

  if (verifications.length > 0) {
    return verifications.reduce((left, right) =>
      (toEpoch(left) ?? 0) >= (toEpoch(right) ?? 0) ? left : right
    );
  }

  const generated = concept.metadata.generated;
  if (isRecord(generated) && typeof generated.at === "string" && toEpoch(generated.at) !== undefined) {
    return generated.at;
  }
  return undefined;
}

function conceptLabel(concept: OkfRawConcept): string {
  const { title } = concept.metadata;
  return typeof title === "string" && title !== ""
    ? title
    : (concept.id ?? concept.path ?? "concept");
}

function locate(concept: OkfRawConcept): Pick<OkfFinding, "id" | "path"> {
  return {
    ...(concept.id === undefined ? {} : { id: concept.id }),
    ...(concept.path === undefined ? {} : { path: concept.path })
  };
}

export function buildReport(
  bundle: OkfBundle,
  options: BuildReportOptions = {}
): OkfReport {
  const now = options.now ?? new Date();
  const sourceTimestamps = options.sourceTimestamps ?? new Map<string, string>();
  const findings: OkfFinding[] = [];
  const trust: Record<TrustTier, number> = {
    "unverified": 0,
    "machine-confirmed": 0,
    "human-reviewed": 0
  };

  for (const issue of bundle.issues) {
    findings.push({
      kind: "conformance",
      severity: issue.severity,
      message: `${issue.code}: ${issue.message}`,
      ...(issue.path === undefined ? {} : { path: issue.path }),
      ...(issue.field === undefined ? {} : { detail: { field: issue.field } })
    });
  }

  const conceptsById = new Map<string, OkfRawConcept>();
  for (const concept of bundle.concepts) {
    const tier = deriveTrustTier(concept);
    trust[tier] += 1;
    if (concept.id !== undefined) {
      conceptsById.set(concept.id, concept);
    }

    if (isStale(concept, now)) {
      findings.push({
        kind: "stale",
        severity: "warning",
        message: `${conceptLabel(concept)} passed stale_after ${String(concept.metadata.stale_after)}.`,
        ...locate(concept),
        detail: { staleAfter: concept.metadata.stale_after, status: getStatus(concept) }
      });
    }

    if (tier === "unverified" && getStatus(concept) !== "draft") {
      findings.push({
        kind: "unverified",
        severity: "info",
        message: `${conceptLabel(concept)} has no valid verified entry.`,
        ...locate(concept),
        detail: { trust: tier }
      });
    }
  }

  for (const edge of buildGraph(bundle.concepts).edges) {
    if (edge.exists) {
      continue;
    }
    const concept = conceptsById.get(edge.from);
    findings.push({
      kind: "broken-link",
      severity: "warning",
      message: `${edge.from} links to missing concept ${edge.to}.`,
      id: edge.from,
      ...(concept?.path === undefined ? {} : { path: concept.path }),
      detail: { target: edge.target, to: edge.to, kind: edge.kind }
    });
  }

  for (const ref of collectSourceRefs(bundle.concepts)) {
    const modified = toEpoch(sourceTimestamps.get(ref.resolved));
    const concept = conceptsById.get(ref.id);
    const confirmed = concept === undefined ? undefined : lastConfirmedAt(concept);
    const confirmedEpoch = toEpoch(confirmed);

    if (modified === undefined || confirmedEpoch === undefined || modified <= confirmedEpoch) {
      continue;
    }
    findings.push({
      kind: "source-drift",
      severity: "warning",
      message: `${ref.id} was last confirmed ${String(confirmed)} but its source ${ref.resource} changed since.`,
      id: ref.id,
      ...(ref.path === undefined ? {} : { path: ref.path }),
      detail: {
        resource: ref.resource,
        resolved: ref.resolved,
        sourceModified: sourceTimestamps.get(ref.resolved),
        confirmedAt: confirmed
      }
    });
  }

  return {
    root: bundle.root,
    ...(bundle.version === undefined ? {} : { version: bundle.version }),
    conceptCount: bundle.concepts.length,
    trust,
    findings
  };
}
