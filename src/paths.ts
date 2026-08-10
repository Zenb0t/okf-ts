const EXTERNAL_TARGET = /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu;

function normalize(
  segments: readonly string[],
  allowEscape: boolean
): string | undefined {
  const normalized: string[] = [];
  let escapes = 0;

  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalized.length > 0) {
        normalized.pop();
        continue;
      }
      if (!allowEscape) {
        return undefined;
      }
      escapes += 1;
      continue;
    }
    normalized.push(segment);
  }

  const parts = [...Array<string>(escapes).fill(".."), ...normalized];
  return parts.length === 0 ? undefined : parts.join("/");
}

export function normalizeSegments(segments: readonly string[]): string | undefined {
  return normalize(segments, false);
}

function resolve(
  from: string,
  target: string,
  allowEscape: boolean
): string | undefined {
  if (
    target.startsWith("#") ||
    target.startsWith("?") ||
    EXTERNAL_TARGET.test(target)
  ) {
    return undefined;
  }

  const path = target.split(/[?#]/u, 1)[0]?.replaceAll("\\", "/");
  if (path === undefined || path === "") {
    return undefined;
  }

  const base = from.split("/").slice(0, -1);
  const segments = path.startsWith("/")
    ? path.slice(1).split("/")
    : [...base, ...path.split("/")];
  return normalize(segments, allowEscape);
}

/**
 * Resolve a Markdown link against the bundle-relative identifier that declares it.
 * Returns `undefined` for fragments, query-only targets, external URLs, and paths
 * that escape the bundle root, because a concept outside the bundle has no identity.
 */
export function resolveRelativePath(
  from: string,
  target: string
): string | undefined {
  return resolve(from, target, false);
}

/**
 * Resolve a `sources[].resource` target the same way, but allow it to escape the
 * bundle root as a `../`-prefixed path. Documentation bundles routinely live in
 * `docs/` while citing the code they describe in `src/`, and git resolves those
 * targets fine when run from the bundle root.
 */
export function resolveSourcePath(
  from: string,
  target: string
): string | undefined {
  return resolve(from, target, true);
}
