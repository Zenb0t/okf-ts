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
  isWellFormedConcept,
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

if (isWellFormedConcept(concept)) {
  // Known OKF fields are now narrowed from unknown to their validated types.
  console.log(concept.metadata.title?.toUpperCase());
}

const markdown = serializeConcept(concept);
```

A bare `verified` mapping is normalized to a one-element list while parsing, as required for OKF consumers. Unknown types and frontmatter keys are preserved when round-tripping.

Parsed frontmatter is intentionally typed as `Record<string, unknown>` because YAML is untrusted input. `isWellFormedConcept` validates every known field and narrows the concept to `WellFormedOkfConcept`. `isConformant` remains the less restrictive specification verdict: a concept may be conformant while still carrying warnings in an optional metadata family.

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

The repository's [`examples/knowledge`](examples/knowledge) directory is a complete OKF 0.2 bundle containing linked Metric, Policy, Reference, and Attested Computation documents. The test suite loads this bundle from disk, validates every document, builds its graph, and derives its trust tiers so the project continuously dogfoods its public APIs.

## Command line

```sh
npx okf-ts report ./knowledge          # work queue: what needs attention and why
npx okf-ts check  ./knowledge          # hard conformance gate; exits 1 on errors
npx okf-ts stamp  ./knowledge/mrr.md --generated process:my-pipeline
```

`report` combines five signals into one ranked list:

| Finding | Severity | Meaning |
| --- | --- | --- |
| `conformance` | error / warning | Issues from `validateBundle`. |
| `source-drift` | warning | A `sources[].resource` changed in git after the concept was last confirmed. |
| `stale` | warning | The absolute `stale_after` date has passed. |
| `broken-link` | warning | A link or source points at a concept the bundle does not contain. |
| `unverified` | info | A non-draft concept carries no valid `verified` entry. |

Source drift is the highest-signal check because it is derived rather than declared:
point a document at the file whose change would make it wrong, and staleness stops being
a guess.

```yaml
sources:
  - resource: ../src/node.ts
```

Source targets may leave the bundle root, so a `docs/` bundle can cite `../src`. Concept
links may not — a concept outside the bundle has no identity. Add `--json` for machine
consumption, `--no-git` to skip drift detection, and `--fail-on-warning` to gate CI on
more than hard conformance.

`stamp` refuses to write `human:` actors. Machine authorship is recorded as `generated`;
human verification is meant to come from a reviewed commit, so that `deriveTrustTier`
keeps meaning something. The repository's
[`plugin/`](https://github.com/Zenb0t/okf-ts/tree/main/plugin) directory ships a Claude
Code plugin that enforces the same boundary when an agent edits documentation directly.

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
| `OkfParseError` | Error thrown for malformed frontmatter or YAML. |
| `validateConcept` | Return hard errors and soft-guidance warnings. |
| `isWellFormedConcept` | Validate all known fields and narrow raw metadata types. |
| `validateBundle` | Validate loaded concepts plus reserved documents. |
| `validateReservedDocument` | Validate a single `index.md` or `log.md`. |
| `isConformant` | Reduce a list of issues to the hard OKF verdict. |
| `deriveTrustTier` | Return `unverified`, `machine-confirmed`, or `human-reviewed`. |
| `normalizeVerified` | Normalize `verified` to a list, whether given as a mapping or list. |
| `isStale` | Apply the absolute `stale_after` date rule. |
| `getStatus` | Return lifecycle status, defaulting to `stable`. |
| `isOkfActor` | Check the OKF human, process, or tool actor convention. |
| `isIsoDate` / `isIsoDateTime` | Strictly validate OKF date and datetime values. |
| `buildGraph` | Build directed link and internal-source edges. |
| `extractMarkdownLinks` | Extract real Markdown links while ignoring code and images. |
| `extractMarkdownHeadings` | Extract heading depths and text. |
| `readBundle` | Recursively load a directory via `okf-ts/node`. |
| `buildReport` | Combine conformance, staleness, links, drift, and trust into one report. |
| `collectSourceRefs` | Resolve `sources[].resource` targets, including non-Markdown ones. |
| `lastConfirmedAt` | Return the newest `verified.at`, falling back to `generated.at`. |
| `resolveRelativePath` | Resolve a link within the bundle root. |
| `resolveSourcePath` | Resolve a source target, allowing it to leave the bundle root. |

The library describes attested computation contracts but does not execute computations or attesters. Runtime receipt and verdict protocols are intentionally deferred by the v0.2 specification.

## Development

```sh
npm ci
npm run check
```

The test suite is behavior-first and enforces at least 95% statement, line, and function coverage plus 90% branch coverage. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## License

Apache-2.0. See [LICENSE](LICENSE).
