import { extractMarkdownLinks } from "./markdown.js";
import { resolveRelativePath } from "./paths.js";
import type {
  OkfGraph,
  OkfGraphEdge,
  OkfGraphEdgeKind,
  OkfRawConcept
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internalConceptId(from: string, target: string): string | undefined {
  const resolved = resolveRelativePath(from, target);
  return resolved?.endsWith(".md") === true ? resolved.slice(0, -3) : undefined;
}

function sourceTargets(concept: OkfRawConcept): string[] {
  const sources = concept.metadata.sources;
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources
    .filter(isRecord)
    .map((source) => source.resource)
    .filter((resource): resource is string => typeof resource === "string");
}

export function buildGraph(concepts: readonly OkfRawConcept[]): OkfGraph {
  const nodes = concepts
    .filter((concept): concept is OkfRawConcept & { id: string } =>
      Boolean(concept.id)
    )
    .map((concept) => ({ id: concept.id, concept }));
  const knownIds = new Set(nodes.map((node) => node.id));
  const edges: OkfGraphEdge[] = [];

  const addEdges = (
    concept: OkfRawConcept & { id: string },
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
