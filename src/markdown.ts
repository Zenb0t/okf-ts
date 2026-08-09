import { fromMarkdown } from "mdast-util-from-markdown";

interface MarkdownNode {
  type: string;
  url?: string;
  value?: string;
  depth?: number;
  children?: MarkdownNode[];
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) {
    walk(child, visit);
  }
}

function nodeText(node: MarkdownNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? []).map(nodeText).join("");
}

export function parseMarkdown(markdown: string): MarkdownNode {
  return fromMarkdown(markdown);
}

export function extractMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  walk(parseMarkdown(markdown), (node) => {
    if (node.type === "link" && typeof node.url === "string") {
      links.push(node.url);
    }
  });
  return links;
}

export interface MarkdownHeading {
  depth: number;
  text: string;
}

export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  walk(parseMarkdown(markdown), (node) => {
    if (node.type === "heading" && typeof node.depth === "number") {
      headings.push({ depth: node.depth, text: nodeText(node).trim() });
    }
  });
  return headings;
}
