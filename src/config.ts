import path from "path";
import { promises as fs } from "fs";
import type { Dirent } from "fs";
import {
  DEFAULT_DB,
  DEFAULT_EDITOR,
  DEFAULT_EXCLUDES,
  DEFAULT_SETUP_STEPS
} from "./constants";
import type { StreamConfig, StatusFile } from "./types";
import { slugify } from "./utils/strings";
import { readJsonFile } from "./utils/fs";

const CONFIG_NAME = "stream.config.json";

function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

async function findUp(startDir: string, filename: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

async function inferBaseRepoPath(configDir: string): Promise<string | undefined> {
  const targetDir = path.resolve(configDir);
  let current = targetDir;
  while (true) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const statusFiles = entries.filter(
      (entry) => entry.isFile() && entry.name.startsWith(".stream-")
    );

    for (const entry of statusFiles) {
      const statusPath = path.join(current, entry.name);
      const status = await readJsonFile<StatusFile>(statusPath);
      if (!status || !status.project || !status.streams) continue;
      const match = Object.values(status.streams).find(
        (stream) => isPathInside(targetDir, path.resolve(stream.path))
      );
      if (match) {
        return path.join(current, status.project);
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return undefined;
}

function resolveNaming(baseRepoPath: string, config?: Partial<StreamConfig>): StreamConfig["naming"] {
  const defaultSlug = slugify(path.basename(baseRepoPath));
  return {
    prefix: config?.naming?.prefix ?? "stream",
    slug: config?.naming?.slug ?? defaultSlug
  };
}

export async function resolveConfig(cwd: string): Promise<StreamConfig> {
  const configPath = await findUp(cwd, CONFIG_NAME);
  const configDir = configPath ? path.dirname(configPath) : cwd;
  const rawConfig = configPath
    ? ((await readJsonFile<Partial<StreamConfig>>(configPath)) ?? {})
    : {};

  let baseRepoPath = rawConfig.baseRepoPath
    ? path.resolve(configDir, rawConfig.baseRepoPath)
    : path.resolve(configDir);
  if (!rawConfig.baseRepoPath) {
    const inferred = await inferBaseRepoPath(path.resolve(configDir));
    if (inferred) baseRepoPath = inferred;
  }

  const streamsRoot = rawConfig.streamsRoot
    ? path.resolve(configDir, rawConfig.streamsRoot)
    : path.dirname(baseRepoPath);

  const naming = resolveNaming(baseRepoPath, rawConfig);

  const editor = {
    command: rawConfig.editor?.command ?? DEFAULT_EDITOR.command,
    openArgs: rawConfig.editor?.openArgs ?? DEFAULT_EDITOR.openArgs
  };

  const setup = {
    enabled: rawConfig.setup?.enabled ?? true,
    steps: rawConfig.setup?.steps ?? DEFAULT_SETUP_STEPS
  };

  const db = {
    type: rawConfig.db?.type ?? DEFAULT_DB.type,
    cloneStrategy: rawConfig.db?.cloneStrategy ?? DEFAULT_DB.cloneStrategy,
    maxNameLength: rawConfig.db?.maxNameLength ?? DEFAULT_DB.maxNameLength,
    envFile: rawConfig.db?.envFile ?? DEFAULT_DB.envFile
  };

  const copyExcludes = rawConfig.copyExcludes ?? DEFAULT_EXCLUDES;

  return {
    baseRepoPath,
    streamsRoot,
    copyExcludes,
    editor,
    setup,
    db,
    naming
  };
}
