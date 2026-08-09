import { marked } from "marked";
import { describe, expect, it } from "vitest";

import {
  buildGraph,
  extractMarkdownHeadings,
  extractMarkdownLinks
} from "../src/index.js";

describe("Markdown link extraction", () => {
  it("resolves inline, full, collapsed, and shortcut reference links", () => {
    const markdown = `
[Inline](./inline.md)
[Full reference][target]
[Collapsed reference][]
[Shortcut reference]
[Unresolved reference][missing]

[target]: ./full.md
[collapsed reference]: /collapsed.md
[shortcut reference]: ../shortcut.md
`;

    expect(extractMarkdownLinks(markdown)).toEqual([
      "./inline.md",
      "./full.md",
      "/collapsed.md",
      "../shortcut.md"
    ]);
  });

  it("includes resolved reference links in the bundle graph", () => {
    const source = {
      id: "metrics/revenue",
      metadata: { type: "Metric" },
      body: "See [the policy][policy].\n\n[policy]: ../policies/revenue.md"
    };
    const target = {
      id: "policies/revenue",
      metadata: { type: "Policy" },
      body: ""
    };

    expect(buildGraph([source, target]).edges).toEqual([
      {
        from: "metrics/revenue",
        to: "policies/revenue",
        kind: "link",
        target: "../policies/revenue.md",
        exists: true
      }
    ]);
  });

  it("finds nested links without treating code as Markdown", () => {
    const markdown = `
> See [the policy][policy].

- [Nested inline](./nested.md)

\`\`\`md
[Not a link](./code.md)
\`\`\`

[policy]: ../policies/revenue.md
`;

    expect(extractMarkdownLinks(markdown)).toEqual([
      "../policies/revenue.md",
      "./nested.md"
    ]);
  });

  it("is isolated from process-global Marked extensions", () => {
    marked.use({
      extensions: [
        {
          name: "okf-test-swallow-blocks",
          level: "block",
          start() {
            return 0;
          },
          tokenizer(source) {
            return { type: "okf-test-swallow-blocks", raw: source };
          }
        }
      ]
    });

    expect(extractMarkdownLinks("# Title\n\n[Target](./target.md)")).toEqual([
      "./target.md"
    ]);
    expect(extractMarkdownHeadings("# Title\n\n[Target](./target.md)")).toEqual([
      { depth: 1, text: "Title" }
    ]);
  });
});
