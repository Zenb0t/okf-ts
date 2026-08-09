import { extractMarkdownLinks } from "./markdown.js";
import type {
  OkfConcept,
  OkfGraph,
  OkfGraphEdge,
  OkfGraphEdgeKind
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(segments: string[]): string | undefined {
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalized.length === 0) {
        return undefined;
      }
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized.join("/");
}

function internalConceptId(from: string, target: string): string | undefined {
  if (
    target.startsWith("#") ||
    target.startsWith("?") ||
    target.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(target)
  ) {
    return undefined;
  }

  const path = target.split(/[?#]/u, 1)[0]?.replaceAll("\\", "/");
  if (!path?.endsWith(".md")) {
    return undefined;
  }

  const withoutSuffix = path.slice(0, -3);
  const base = from.split("/").slice(0, -1);
  const segments = withoutSuffix.startsWith("/")
    ? withoutSuffix.slice(1).split("/")
    : [...base, ...withoutSuffix.split("/")];
  return normalizePath(segments);
}

function sourceTargets(concept: OkfConcept): string[] {
  const sources = concept.metadata.sources;
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources
    .filter(isRecord)
    .map((source) => source.resource)
    .filter((resource): resource is string => typeof resource === "string");
}

export function buildGraph(concepts: readonly OkfConcept[]): OkfGraph {
  const nodes = concepts
    .filter((concept): concept is OkfConcept & { id: string } =>
      Boolean(concept.id)
    )
    .map((concept) => ({ id: concept.id, concept }));
  const knownIds = new Set(nodes.map((node) => node.id));
  const edges: OkfGraphEdge[] = [];

  const addEdges = (
    concept: OkfConcept & { id: string },
    targets: readonly string[],
    kind: OkfGraphEdgeKind
  ): void => {
    for (const target of targets) {
      const to = internalConceptId(concept.id, target);
      if (to !== undefined) {
        edges.push({
          from: concept.id,
          to,
          kind,
          target,
          exists: knownIds.has(to)
        });
      }
    }
  };

  for (const node of nodes) {
    addEdges(node.concept, extractMarkdownLinks(node.concept.body), "link");
    addEdges(node.concept, sourceTargets(node.concept), "source");
  }

  return { nodes, edges };
}
