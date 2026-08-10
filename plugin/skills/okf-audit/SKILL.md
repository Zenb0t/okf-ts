---
name: okf-audit
description: Audits an OKF documentation bundle and triages what needs repair. Use when the user runs /okf-audit, asks which docs are stale or out of date, asks what documentation needs review, or wants to know which docs drifted from the code they describe.
argument-hint: "[bundle-path] [--fix]"
allowed-tools: Bash, Read, Edit, Grep, Glob
version: 0.1.0
---

# Audit an OKF bundle

Produce a ranked, actionable picture of documentation health — then, only if asked,
repair the top findings.

## Steps

1. Resolve the bundle path from `$1`, defaulting to `docs` if it exists, otherwise `.`.
   Confirm the guess in your summary rather than asking.

2. Run the report:

   ```bash
   npx okf-ts report <bundle> --json
   ```

   If `npx` fails because the package is absent, say so and suggest
   `npm install --save-dev okf-ts`. Do not fall back to reading every file by hand.

3. Group findings by kind and report them in this order, because it is the order of
   decreasing signal:

   | Order | Kind | Why it ranks here |
   |---|---|---|
   | 1 | `conformance` (error) | The bundle is malformed; other checks are unreliable |
   | 2 | `source-drift` | The code moved after the doc was last confirmed — near-certain rot |
   | 3 | `stale` | A declared expiry passed; may or may not be real |
   | 4 | `broken-link` | Spec-permitted, but usually a rename that was missed |
   | 5 | `unverified` | Advisory: nobody has ever confirmed this doc |

4. Summarize as a short table: kind, count, and the specific documents. Include the trust
   split (`human-reviewed` / `machine-confirmed` / `unverified`) — it tells the user how
   much of the corpus anyone has actually vouched for.

5. For each `source-drift` finding, name the source file that moved and run
   `git log --oneline -3 -- <source>` so the user sees *what* changed. This is the
   difference between a report and a diagnosis.

6. Stop and present. Do not begin editing unless `--fix` was passed or the user asks.

## With --fix

Repair findings one at a time, highest rank first:

1. Read the document and the source of truth it cites — the code, the linked policy, the
   git history. Never rewrite documentation from the old text alone.
2. Edit the body to match reality.
3. Stamp it: `npx okf-ts stamp <file> --generated process:claude-code`
4. Re-run the report to confirm the finding cleared.

Never write a `verified:` entry with a `human:` actor — see the okf-conventions skill.
The human confers that by reviewing the diff you produced.

Leave every repair in the working tree for review. Do not commit.
