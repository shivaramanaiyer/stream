import path from "path";

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegExp(pattern: string): RegExp {
  const normalized = pattern.split(path.sep).join("/");
  let regex = "";
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    if (char === "*") {
      const next = normalized[i + 1];
      if (next === "*") {
        regex += ".*";
        i += 2;
      } else {
        regex += "[^/]*";
        i += 1;
      }
    } else if (char === "?") {
      regex += ".";
      i += 1;
    } else {
      regex += escapeRegExp(char);
      i += 1;
    }
  }
  return new RegExp(`^${regex}$`);
}

function matchPattern(relPath: string, pattern: string): boolean {
  const normalized = relPath.split(path.sep).join("/");
  if (pattern.includes("/") || pattern.includes(path.sep)) {
    return patternToRegExp(pattern).test(normalized);
  }
  const segments = normalized.split("/");
  const segmentRegex = patternToRegExp(pattern);
  return segments.some((seg) => segmentRegex.test(seg));
}

export function createMatcher(patterns: string[]): (relPath: string) => boolean {
  const cleaned = patterns
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (cleaned.length === 0) {
    return () => false;
  }
  return (relPath) => cleaned.some((pattern) => matchPattern(relPath, pattern));
}

export function buildIncludePredicate(
  includes: string[],
  excludes: string[]
): (relPath: string) => boolean {
  const includeMatch = createMatcher(includes);
  const excludeMatch = createMatcher(excludes);
  const includePrefixes = includes
    .map((p) => p.split(path.sep).join("/"))
    .map((p) => {
      const wildcardIndex = p.search(/[\*\?]/);
      return wildcardIndex === -1 ? p : p.slice(0, wildcardIndex);
    })
    .filter((p) => p.length > 0);

  return (relPath: string) => {
    const normalized = relPath.split(path.sep).join("/");
    if (includeMatch(normalized)) return true;
    if (excludeMatch(normalized)) return false;
    if (includes.length > 0) {
      return includePrefixes.some((prefix) =>
        normalized === prefix || normalized.startsWith(`${prefix}/`)
      );
    }
    return true;
  };
}
