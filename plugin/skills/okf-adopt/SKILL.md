---
name: okf-adopt
description: Adds OKF frontmatter to existing Markdown documentation so it can be tracked and audited. Use when the user runs /okf-adopt, asks to migrate or onboard docs to OKF, wants to start tracking documentation staleness or provenance, or asks how to add OKF frontmatter to an existing doc tree.
argument-hint: "[docs-path]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
version: 0.1.0
---

# Adopt OKF in an existing doc tree

Convert plain Markdown into an OKF bundle. This is a one-time migration per tree, and it
is worth doing carefully — bad frontmatter produces a noisy report that nobody trusts.

## Scope first

Adopt the docs that make **checkable claims**: references, runbooks, schemas, policies,
architecture notes, metric definitions. Skip tutorials, essays, changelogs, and READMEs
whose accuracy is not a function of some other artifact. Adopting everything creates
findings nobody can act on.

Say which files you are skipping and why. If the user pushes back, adopt them.

## Steps

1. Inventory the tree with Glob, then read enough of each file to classify it.

2. Agree on a type vocabulary before writing anything. Reuse types already present in the
   repository; otherwise propose a small set (`Reference`, `Runbook`, `ADR`, `Guide`,
   `Schema`) and list which files get which. Present this and wait for confirmation —
   retyping a tree afterwards is expensive.

3. For each adopted file, prepend frontmatter:

   ```yaml
   ---
   type: Reference
   title: <the document's real title>
   sources:
     - resource: ../src/thing.ts
   ---
   ```

   - `title` — take it from the first H1; do not invent one.
   - `sources` — the single most valuable field. Point at the file whose change would
     make this doc wrong. Find it by reading the doc and grepping for what it describes.
     A path may leave the bundle (`../src/…`).
   - `stale_after` — only for claims that expire on a calendar, not on a commit.
   - Never add a `verified` entry. Everything you adopt starts `unverified`, and that is
     the honest state: no human has confirmed it since it entered the system.

4. Preserve existing frontmatter keys verbatim, including unknown ones.

5. Validate and report:

   ```bash
   npx okf-ts check <docs-path>
   npx okf-ts report <docs-path>
   ```

   Fix every `error` before finishing. Expect a large `unverified` count — that is
   correct after adoption, not a failure.

6. Suggest the CI gate as a follow-up, and offer to add it rather than adding it
   unasked:

   ```yaml
   - run: npx okf-ts check docs
   ```

## Verify a sample

After adopting more than ten files, pick two at random, read them against their declared
`sources`, and report whether the frontmatter you wrote is actually true. Adoption that
mislabels sources is worse than no adoption, because the drift signal becomes noise.
