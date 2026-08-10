---
name: OKF documentation conventions
description: Conventions and the maintenance loop for documentation stored as an Open Knowledge Format bundle. Use when working in a repository whose Markdown docs carry OKF frontmatter (type, verified, generated, stale_after, sources), when writing or editing such a document, when asked about doc staleness, doc provenance, trust tiers, source drift, or `okf report`/`okf check`/`okf stamp`, and before adding frontmatter to any documentation file.
version: 0.1.0
---

# OKF documentation conventions

Documentation in an OKF bundle is a Markdown file with YAML frontmatter. The frontmatter
carries provenance the tooling can verify; the body is ordinary prose.

## Minimum viable concept

```yaml
---
type: Reference
title: Bundle loading
---
```

`type` is the only hard requirement. Everything else is optional and only earns its place
when it makes a checkable claim.

## Choosing a type

OKF v0.2 defines `Metric`, `Policy`, `Reference`, and `Attested Computation`, and raises
**no issue for unknown types**. Invent what the repository needs — `Runbook`, `ADR`,
`Guide`, `Schema`, `Contract`. Reuse the types already present in the bundle; run
`okf report --json` and read the existing docs before coining a new one.

## The trust model — the one hard rule

`deriveTrustTier` reads the `verified` field and returns one of three verdicts:

| Field written | Tier |
|---|---|
| nothing | `unverified` |
| `verified: { by: process:… }` | `machine-confirmed` |
| `verified: { by: human:… }` | `human-reviewed` |

**Never write a `verified` entry with a `human:` actor.** Not when adopting, not when
repairing, not when the user says a human reviewed it. The whole point of the tier is to
separate what a model asserted from what a person checked; an agent writing that stamp
destroys the distinction. Record authorship as `generated` instead:

```yaml
generated:
  by: process:claude-code
  at: 2026-08-10T09:00:00Z
```

Human verification arrives when a person merges the reviewed commit. A PreToolUse hook
enforces this and will block the edit.

## Pointing docs at their source of truth

Prefer derived staleness over guessed dates. `sources[].resource` may point at any file,
including code, and may sit outside the bundle:

```yaml
sources:
  - resource: ../src/node.ts
```

`okf report` then asks git when that file last changed and flags the doc when it moved
after the doc was last confirmed. This is `source-drift`, and it is the highest-signal
finding available — act on it before staleness.

Use `stale_after: YYYY-MM-DD` only when a claim expires on a calendar, not on a commit
(a quota, a fiscal policy, a compliance window).

## Extension fields

Unknown keys round-trip untouched through parse and serialize, so ownership and routing
metadata is safe to add: `x-owner`, `x-review-cadence`, `x-jira`. Preserve any that
already exist when editing a document.

## The maintenance loop

1. **Report** — `npx okf-ts report <bundle> --json` produces the work queue. Never guess
   what is stale by reading files.
2. **Repair** — pick a finding, read the *actual* source of truth (the code, git log, the
   linked policy), rewrite the body.
3. **Stamp** — `npx okf-ts stamp <file> --generated process:claude-code` records machine
   authorship and refreshes the timestamp drift is measured against.
4. **Verify** — stop. The human reviews the diff; merging is what confers
   `human-reviewed`.

## Commands

| Command | Purpose |
|---|---|
| `npx okf-ts report <root> [--json] [--no-git] [--fail-on-warning]` | Work queue: conformance, staleness, broken links, source drift, trust tiers |
| `npx okf-ts check <root> [--json]` | Hard OKF conformance gate; exits 1 on errors — use in CI |
| `npx okf-ts stamp <file> --generated <actor> [--at <iso>] [--stale-after <date>] [--dry-run]` | Record machine authorship |

Finding severities: `error` is a hard conformance failure and must be fixed; `warning`
is staleness, drift, or a broken link and should be triaged; `info` is advisory.

Broken links are permitted by the OKF spec — treat them as a signal, not a build failure,
unless the repository has opted into `--fail-on-warning`.
