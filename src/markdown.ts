import { Marked } from "marked";

import type { Token, TokensList } from "marked";

const markdownParser = new Marked();

function parseMarkdown(markdown: string): TokensList {
  return markdownParser.lexer(markdown);
}

function tokenText(token: Token): string {
  if ("tokens" in token && Array.isArray(token.tokens)) {
    return token.tokens.map(tokenText).join("");
  }
  if ("text" in token && typeof token.text === "string") {
    return token.text;
  }
  return "";
}

export function extractMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  void markdownParser.walkTokens(parseMarkdown(markdown), (token) => {
    if (token.type === "link" && typeof token.href === "string") {
      links.push(token.href);
    }
  });
  return links;
}

export function countMarkdownCodeBlocksUnderHeading(
  markdown: string,
  headingText: string,
  headingDepth = 1
): number {
  const tokens = parseMarkdown(markdown);
  let insideSection = false;
  let count = 0;

  for (const token of tokens) {
    if (token.type === "heading") {
      if (
        token.depth === headingDepth &&
        tokenText(token).trim() === headingText
      ) {
        insideSection = true;
        continue;
      }
      if (insideSection && token.depth <= headingDepth) {
        insideSection = false;
      }
    } else if (insideSection && token.type === "code") {
      count += 1;
    }
  }
  return count;
}

export interface MarkdownHeading {
  depth: number;
  text: string;
}

export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  void markdownParser.walkTokens(parseMarkdown(markdown), (token) => {
    if (token.type === "heading" && typeof token.depth === "number") {
      headings.push({
        depth: token.depth,
        text: tokenText(token).trim()
      });
    }
  });
  return headings;
}
