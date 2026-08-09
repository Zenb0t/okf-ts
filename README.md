# okf-ts

A small, permissive TypeScript toolkit for the [Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

`okf-ts` parses and writes concept documents, validates concepts and bundles, derives trust and lifecycle state, and builds relationship graphs. The core entry point has no Node.js dependencies; recursive filesystem loading is available from `okf-ts/node`.

This is an independent implementation and is not an official Google project.

## Install

```sh
npm install okf-ts
```

The package is ESM-only and requires Node.js 20 or newer for the Node entry point.

## Parse and validate

```ts
import {
  deriveTrustTier,
  isConformant,
  isStale,
  parseConcept,
  serializeConcept,
  validateConcept
} from "okf-ts";

const source = `---
type: Metric
title: Revenue
verified: { by: human:ada, at: 2026-08-02T10:00:00Z }
stale_after: 2026-12-31
x-company-owner: finance
---
# Definition

Recognized revenue for the fiscal year.
`;

const concept = parseConcept(source);
const issues = validateConcept(concept);

console.log(isConformant(issues)); // true
console.log(deriveTrustTier(concept)); // human-reviewed
console.log(isStale(concept, new Date("2027-01-01T00:00:00Z"))); // true

const markdown = serializeConcept(concept);
```

A bare `verified` mapping is normalized to a one-element list while parsing, as required for OKF consumers. Unknown types and frontmatter keys are preserved when round-tripping.

## Read a bundle

```ts
import { buildGraph, isConformant } from "okf-ts";
import { readBundle } from "okf-ts/node";

const bundle = await readBundle("./knowledge");
const graph = buildGraph(bundle.concepts);

console.log(bundle.version); // declared by the root index.md, when present
console.log(isConformant(bundle.issues));
console.log(graph.edges.filter((edge) => !edge.exists));
```

`readBundle` scans `.md` files recursively, skips symbolic links, assigns concept IDs from bundle-relative paths, and collects parse or conformance issues without aborting the entire bundle. Broken cross-links are retained in the graph with `exists: false`, because OKF explicitly permits them.

## Validation model

OKF v0.2 has a deliberately small hard-conformance surface. `okf-ts` reports:

- `error` for hard conformance failures, such as a missing concept `type` or malformed reserved files.
- `warning` for malformed optional provenance, trust, lifecycle, and computation fields.
- no issue for unknown concept types, extension fields, broken links, or missing indexes.

Use `isConformant(issues)` when you only need the hard OKF verdict. Inspect all issues when authoring or reviewing a bundle.

## API

| Export | Purpose |
| --- | --- |
| `parseConcept` | Parse YAML frontmatter and Markdown body. |
| `serializeConcept` | Serialize a concept while preserving extension data. |
| `validateConcept` | Return hard errors and soft-guidance warnings. |
| `validateBundle` | Validate loaded concepts plus reserved documents. |
| `deriveTrustTier` | Return `unverified`, `machine-confirmed`, or `human-reviewed`. |
| `isStale` | Apply the absolute `stale_after` date rule. |
| `getStatus` | Return lifecycle status, defaulting to `stable`. |
| `buildGraph` | Build directed link and internal-source edges. |
| `extractMarkdownLinks` | Extract real Markdown links while ignoring code and images. |
| `readBundle` | Recursively load a directory via `okf-ts/node`. |

The library describes attested computation contracts but does not execute computations or attesters. Runtime receipt and verdict protocols are intentionally deferred by the v0.2 specification.

## Development

```sh
npm ci
npm run check
```

The test suite is behavior-first and enforces at least 95% statement, line, and function coverage plus 90% branch coverage. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## License

Apache-2.0. See [LICENSE](LICENSE).
