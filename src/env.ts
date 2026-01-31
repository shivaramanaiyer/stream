import path from "path";
import { readFileIfExists } from "./utils/fs";

export function parseEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export async function readEnvFile(path: string): Promise<Record<string, string>> {
  const raw = await readFileIfExists(path);
  return raw ? parseEnv(raw) : {};
}

export function updateEnvValue(raw: string, key: string, value: string): string {
  const lines = raw.split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (line.trim().startsWith("#")) return line;
    const idx = line.indexOf("=");
    if (idx === -1) return line;
    const existingKey = line.slice(0, idx).trim();
    if (existingKey !== key) return line;
    found = true;
    return `${existingKey}=${value}`;
  });

  if (!found) updated.push(`${key}=${value}`);
  return updated.join("\n");
}

export function resolveEnvFileRelPath(baseRepoPath: string, envFile: string): string {
  const base = path.resolve(baseRepoPath);
  const resolved = path.isAbsolute(envFile)
    ? path.resolve(envFile)
    : path.resolve(baseRepoPath, envFile);
  if (resolved === base || resolved.startsWith(`${base}${path.sep}`)) {
    return path.relative(base, resolved);
  }
  throw new Error(`Env file must be within base repo: ${envFile}`);
}
