# okf-docs plugin

A Claude Code plugin that lets an agent maintain documentation as an Open Knowledge
Format bundle — and prevents it from vouching for its own work.

## Why

Agent-maintained docs decay in a specific way: after a few passes nobody can tell what a
human blessed from what a model asserted. OKF separates those already — `generated` is
authorship, `verified` is confirmation, and `deriveTrustTier` collapses them into
`unverified` / `machine-confirmed` / `human-reviewed`.

This plugin makes that separation enforceable. An agent may stamp `process:` actors
freely; a `PreToolUse` hook blocks it from writing a `verified` entry with a `human:`
actor. Human review is conferred by merging a reviewed commit, not by an agent typing it.

## Components

| Component | What it does |
|---|---|
| `okf-conventions` skill | Auto-activates in OKF repos: frontmatter conventions, type vocabulary, the trust rule, the maintenance loop |
| `/okf-audit [path] [--fix]` | Runs `okf report`, ranks findings by signal, diagnoses drift against git history |
| `/okf-adopt [path]` | Adds frontmatter to an existing doc tree, scoped to docs that make checkable claims |
| `block-human-stamp` hook | `PreToolUse` on `Write`/`Edit` of `.md`: denies agent-authored human verification |

## Requirements

- Node.js 20+
- `okf-ts` reachable via `npx` (no global install needed)
- git, for source-drift detection

## Install

```sh
claude --plugin-dir /path/to/okf-tool/plugin
```

Hooks load at session start — restart Claude Code after changing hook configuration.

## The loop

```
ADOPT ──► REPORT ──► REPAIR ──► VERIFY ──► (loop)
once      /okf-audit  agent      human PR    CI
```

1. `/okf-adopt docs` — one-time migration.
2. `/okf-audit docs` — the work queue, ranked: conformance errors, then source drift,
   then staleness, then broken links.
3. Agent repairs against the real source of truth and stamps `generated: process:…`.
4. You review the diff. Merging is what confers `human-reviewed`.

## Hook behavior

| Situation | Decision |
|---|---|
| `verified:` block containing a `human:` actor | **deny** |
| `verified: { by: human:… }` inline mapping | **deny** |
| `by: human:…` with no visible enclosing key (small Edit fragment) | **ask** |
| `generated:`, `attester:`, or any other block with a `human:` actor | allow |
| Non-`.md` files | ignored |

The `ask` case exists because an `Edit` often carries too small a fragment to prove
context. It surfaces the change to you rather than guessing.

To disable the hook, remove `hooks/hooks.json` and restart. Note that doing so reduces
the trust tier from a guarantee to a convention.
