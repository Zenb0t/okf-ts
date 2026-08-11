import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * These exercise the plugin hook through the contract Claude Code actually uses:
 * a PreToolUse payload on stdin, a permission decision on stdout. Unit-testing the
 * exported classifier would leave the payload handling, the Markdown filter, and
 * the output shape untested, and those are the parts that decide whether a forged
 * human verification is caught.
 */
const hookPath = fileURLToPath(
  new URL("../plugin/hooks/scripts/block-human-stamp.mjs", import.meta.url)
);

interface HookResult {
  code: number;
  stdout: string;
}

function runHook(payload: unknown): Promise<HookResult> {
  return new Promise<HookResult>((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

interface HookOutput {
  hookSpecificOutput?: { hookEventName?: string; permissionDecision?: string };
  systemMessage?: string;
}

async function decisionFor(
  content: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { stdout } = await runHook({
    tool_name: "Write",
    tool_input: { file_path: "docs/concept.md", content },
    ...overrides
  });
  if (stdout.trim() === "") {
    return "allow";
  }
  return (
    (JSON.parse(stdout) as HookOutput).hookSpecificOutput?.permissionDecision ??
    "allow"
  );
}

describe("verification hook — denies forged human review", () => {
  it("denies a verified block naming a human actor", async () => {
    expect(
      await decisionFor(
        "---\ntype: Metric\nverified:\n  by: human:ada\n  at: 2026-08-01T00:00:00Z\n---\n"
      )
    ).toBe("deny");
  });

  it("denies a human actor inside a verified list", async () => {
    expect(
      await decisionFor(
        "---\nverified:\n  - by: human:ada\n    at: 2026-08-01T00:00:00Z\n---\n"
      )
    ).toBe("deny");
  });

  it("denies a human entry hidden among valid process verifications", async () => {
    expect(
      await decisionFor(
        "---\nverified:\n  - by: process:ci\n    at: 2026-01-01T00:00:00Z\n  - by: human:ada\n    at: 2026-08-01T00:00:00Z\n---\n"
      )
    ).toBe("deny");
  });

  it("denies an inline verified mapping on a single line", async () => {
    expect(
      await decisionFor(
        "---\nverified: { by: human:ada, at: 2026-08-01T00:00:00Z }\n---\n"
      )
    ).toBe("deny");
  });

  it("denies a verified block that follows an unrelated nested block", async () => {
    expect(
      await decisionFor(
        "---\nsources:\n  - resource: a.md\nverified:\n  by: human:ada\n  at: 2026-08-01T00:00:00Z\n---\n"
      )
    ).toBe("deny");
  });
});

describe("verification hook — permits legitimate authorship", () => {
  it("allows a human actor under generated, which confers no trust tier", async () => {
    expect(
      await decisionFor(
        "---\ngenerated:\n  by: human:ada\n  at: 2026-08-01T00:00:00Z\n---\n"
      )
    ).toBe("allow");
  });

  it("allows an inline generated mapping naming a human", async () => {
    expect(
      await decisionFor(
        "---\ngenerated: { by: human:ada, at: 2026-08-01T00:00:00Z }\n---\n"
      )
    ).toBe("allow");
  });

  it("allows a machine verification", async () => {
    expect(
      await decisionFor(
        "---\nverified:\n  by: process:claude-code\n  at: 2026-08-01T00:00:00Z\n---\n"
      )
    ).toBe("allow");
  });

  it("does not treat a verified block as open after a sibling key closes it", async () => {
    expect(
      await decisionFor(
        "---\nverified:\n  by: process:ci\n  at: 2026-01-01T00:00:00Z\nowner: human:ada\n---\n"
      )
    ).toBe("allow");
  });

  it("ignores the word human in ordinary prose", async () => {
    expect(await decisionFor("# On human: centred design\n\nProse.\n")).toBe("allow");
  });
});

describe("verification hook — ambiguity and scope", () => {
  it("asks rather than guessing when an edit fragment hides its parent key", async () => {
    const { stdout } = await runHook({
      tool_name: "Edit",
      tool_input: {
        file_path: "docs/concept.md",
        new_string: "  by: human:ada\n  at: 2026-08-01T00:00:00Z\n"
      }
    });
    const output = JSON.parse(stdout) as HookOutput;
    expect(output.hookSpecificOutput?.permissionDecision).toBe("ask");
    expect(output.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
    expect(output.systemMessage).toBeTruthy();
  });

  it("inspects every edit in a multi-edit payload", async () => {
    const { stdout } = await runHook({
      tool_name: "Edit",
      tool_input: {
        file_path: "docs/concept.md",
        edits: [
          { new_string: "title: Revenue\n" },
          { new_string: "verified:\n  by: human:ada\n  at: 2026-08-01T00:00:00Z\n" }
        ]
      }
    });
    expect(
      (JSON.parse(stdout) as HookOutput).hookSpecificOutput?.permissionDecision
    ).toBe("deny");
  });

  it("leaves non-Markdown files alone", async () => {
    expect(
      await decisionFor("verified:\n  by: human:ada\n", {
        tool_input: {
          file_path: "src/thing.ts",
          content: "verified:\n  by: human:ada\n"
        }
      })
    ).toBe("allow");
  });

  it("leaves tools other than Write and Edit alone", async () => {
    const { stdout } = await runHook({
      tool_name: "Read",
      tool_input: {
        file_path: "docs/concept.md",
        content: "verified:\n  by: human:ada\n"
      }
    });
    expect(stdout.trim()).toBe("");
  });

  it("stays out of the way when stdin is not valid JSON", async () => {
    const child = spawn(process.execPath, [hookPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    const code = await new Promise<number>((resolve) => {
      child.on("close", (value) => {
        resolve(value ?? -1);
      });
      child.stdin.end("not json at all");
    });

    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("never fails the tool call, even when denying", async () => {
    const { code } = await runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "docs/concept.md",
        content: "verified:\n  by: human:ada\n  at: 2026-08-01T00:00:00Z\n"
      }
    });
    expect(code).toBe(0);
  });
});
