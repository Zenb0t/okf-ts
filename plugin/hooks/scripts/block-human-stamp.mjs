#!/usr/bin/env node
/**
 * Guards the OKF trust boundary.
 *
 * `deriveTrustTier` only returns "human-reviewed" when a concept carries a
 * `verified` entry whose actor starts with `human:`. That verdict is worthless if
 * the agent writing the documentation can also write the stamp attesting that a
 * human reviewed it. This hook makes the boundary structural rather than advisory:
 * an agent may record `generated: { by: process:... }` freely, but a human
 * verification must arrive through a reviewed commit.
 *
 * Decisions:
 *   deny  - the edit clearly adds a human actor inside a `verified` block
 *   ask   - a `by: human:` line appears without visible `verified` context
 *           (common for small Edit fragments), so a person confirms instead
 *   allow - everything else, including `generated: { by: human:... }`
 */

import { pathToFileURL } from "node:url";

const KEY_LINE = /^(\s*)(?:-\s+)?([A-Za-z_][\w-]*):(.*)$/u;
const HUMAN_VALUE = /^\s*(?:["']?)human:\S/u;
const HUMAN_ANYWHERE = /\bhuman:\S/u;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

/**
 * Walk the YAML-ish text tracking whether the current line sits inside a
 * `verified:` block. Works on whole documents and on partial Edit fragments.
 */
export function classify(text) {
  if (typeof text !== "string" || !text.includes("human:")) {
    return "allow";
  }

  let block = null;
  let looseHuman = false;

  for (const line of text.split(/\r?\n/u)) {
    const match = KEY_LINE.exec(line);
    if (match === null) {
      continue;
    }

    const indent = match[1].length;
    const key = match[2];
    const rest = match[3];

    if (block !== null && indent <= block.indent) {
      block = null;
    }

    // Inline mapping on one line: `verified: { by: human:ada, at: ... }`
    if (key === "verified" && HUMAN_ANYWHERE.test(rest)) {
      return "deny";
    }

    // A key with nothing after the colon opens a nested block.
    if (rest.trim() === "") {
      block = { key, indent };
      continue;
    }

    if (key === "by" && HUMAN_VALUE.test(rest)) {
      if (block === null) {
        // No enclosing key is visible — typical of a small Edit fragment.
        looseHuman = true;
      } else if (block.key === "verified") {
        return "deny";
      }
      // Any other parent (`generated`, `attester`, …) is a legitimate place for a
      // human actor and confers no trust tier.
    }
  }

  return looseHuman ? "ask" : "allow";
}

function editedText(toolName, toolInput) {
  if (toolName === "Write") {
    return typeof toolInput.content === "string" ? toolInput.content : "";
  }
  if (typeof toolInput.new_string === "string") {
    return toolInput.new_string;
  }
  if (Array.isArray(toolInput.edits)) {
    return toolInput.edits
      .map((edit) => (typeof edit?.new_string === "string" ? edit.new_string : ""))
      .join("\n");
  }
  return "";
}

function emit(decision, message) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: message
      },
      systemMessage: message
    })}\n`
  );
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // Malformed input is not this hook's problem; stay out of the way.
  }

  const toolName = payload.tool_name;
  const toolInput = payload.tool_input;
  if ((toolName !== "Write" && toolName !== "Edit") || typeof toolInput !== "object" || toolInput === null) {
    return;
  }

  const path = typeof toolInput.file_path === "string" ? toolInput.file_path : "";
  if (!path.toLowerCase().endsWith(".md")) {
    return;
  }

  const decision = classify(editedText(toolName, toolInput));
  if (decision === "deny") {
    emit(
      "deny",
      "Blocked: this edit adds a `verified:` entry with a human: actor. An agent cannot " +
        "attest that a human reviewed a document — that would make deriveTrustTier() " +
        "meaningless. Record `generated: { by: process:<name> }` instead (okf stamp does " +
        "this), and let the human verification come from the reviewed commit."
    );
  } else if (decision === "ask") {
    emit(
      "ask",
      "This edit writes a `by: human:` actor. If it belongs to a `verified:` block, an " +
        "agent must not author it. Confirm only if this is a `generated:` actor or a " +
        "human is making this change themselves."
    );
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  await main();
}
