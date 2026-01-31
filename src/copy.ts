import path from "path";
import { promises as fs } from "fs";
import { buildIncludePredicate } from "./utils/patterns";
import { ensureDir } from "./utils/fs";

export interface CopyOptions {
  excludes: string[];
  includes: string[];
}

export async function copyRepo(
  source: string,
  dest: string,
  options: CopyOptions
): Promise<void> {
  const shouldInclude = buildIncludePredicate(options.includes, options.excludes);
  await ensureDir(path.dirname(dest));
  await fs.cp(source, dest, {
    recursive: true,
    errorOnExist: true,
    filter: (src) => {
      if (src === source) return true;
      const rel = path.relative(source, src);
      if (!rel) return true;
      return shouldInclude(rel);
    }
  });
}
