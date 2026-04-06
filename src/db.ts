import path from "path";
import { promises as fs } from "fs";
import { spawn } from "child_process";
import type { CloneStrategy, DbEnv, StreamConfig } from "./types";
import { readEnvFile, resolveEnvFileRelPath, updateEnvValue } from "./env";
import { sanitizeDbName } from "./utils/strings";
import { runCommand } from "./utils/exec";
import { logDebug, logInfo, logWarn } from "./logger";
import { ensureDir, pathExists, readFileIfExists } from "./utils/fs";

function buildDbName(base: string, lane: string, maxLength: number): string {
  const combined = `${base}__${lane}`;
  return sanitizeDbName(combined, maxLength);
}

function requireEnv(env: Record<string, string>, key: string, envPath: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing ${key} in ${envPath}`);
  return value;
}

function buildPgEnv(db: DbEnv): Record<string, string | undefined> {
  return {
    PGHOST: db.POSTGRES_HOST,
    PGPORT: db.POSTGRES_PORT,
    PGUSER: db.POSTGRES_USER,
    PGPASSWORD: db.POSTGRES_PASSWORD
  };
}

async function runPsql(
  command: string,
  env: Record<string, string | undefined>,
  stdoutToStderr?: boolean
): Promise<void> {
  const result = await runCommand("psql", ["-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", command], {
    env,
    inheritStdout: true,
    stdoutToStderr
  });
  if (result.code !== 0) {
    throw new Error(`psql failed with code ${result.code}`);
  }
}

async function createDatabase(
  dbName: string,
  env: Record<string, string | undefined>,
  stdoutToStderr?: boolean
): Promise<void> {
  await runPsql(`CREATE DATABASE \"${dbName}\"`, env, stdoutToStderr);
}

async function createDatabaseWithTemplate(
  newDb: string,
  templateDb: string,
  env: Record<string, string | undefined>,
  stdoutToStderr?: boolean
): Promise<void> {
  await runPsql(`CREATE DATABASE \"${newDb}\" WITH TEMPLATE \"${templateDb}\"`, env, stdoutToStderr);
}

async function dumpAndRestore(
  sourceDb: string,
  targetDb: string,
  env: Record<string, string | undefined>,
  stdoutToStderr?: boolean
): Promise<void> {
  await createDatabase(targetDb, env, stdoutToStderr);
  await new Promise<void>((resolve, reject) => {
    const dump = spawn("pg_dump", ["-Fc", "-d", sourceDb], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const restoreStdout = stdoutToStderr ? "pipe" : "inherit";
    const restoreStderr = stdoutToStderr ? "pipe" : "inherit";
    const restore = spawn("pg_restore", ["-d", targetDb], {
      env: { ...process.env, ...env },
      stdio: ["pipe", restoreStdout, restoreStderr]
    });

    if (!dump.stdout) {
      reject(new Error("pg_dump stdout is not available."));
      return;
    }
    if (!restore.stdin) {
      reject(new Error("pg_restore stdin is not available."));
      return;
    }
    dump.stdout.pipe(restore.stdin);

    let dumpError = "";
    dump.stderr.on("data", (chunk: Buffer) => {
      dumpError += chunk.toString();
    });
    if (stdoutToStderr && restore.stdout) {
      restore.stdout.on("data", (chunk: Buffer) => {
        process.stderr.write(chunk);
      });
    }
    if (stdoutToStderr && restore.stderr) {
      restore.stderr.on("data", (chunk: Buffer) => {
        process.stderr.write(chunk);
      });
    }

    dump.on("error", reject);
    restore.on("error", reject);

    let dumpExit: number | null = null;
    let restoreExit: number | null = null;

    const finalize = () => {
      if (dumpExit === null || restoreExit === null) return;
      if (dumpExit !== 0) {
        reject(new Error(`pg_dump failed with code ${dumpExit}: ${dumpError}`));
        return;
      }
      if (restoreExit !== 0) {
        reject(new Error(`pg_restore failed with code ${restoreExit}`));
        return;
      }
      resolve();
    };

    dump.on("close", (code: number | null) => {
      dumpExit = code;
      if (restore.stdin) {
        restore.stdin.end();
      }
      finalize();
    });

    restore.on("close", (code: number | null) => {
      restoreExit = code;
      finalize();
    });
  });
}

export interface CloneResult {
  dbName: string;
}

function ensurePostgresConfig(config: StreamConfig): void {
  if (config.db.type !== "postgres") {
    throw new Error(`Unsupported db type: ${config.db.type}`);
  }
}

function resolveEnvFile(config: StreamConfig): string {
  const cleaned = config.db.envFile?.trim();
  if (!cleaned) {
    throw new Error("No env file configured for db clone.");
  }
  return resolveEnvFileRelPath(config.baseRepoPath, cleaned);
}

async function loadDbEnv(
  baseRepoPath: string,
  envFile: string
): Promise<{ envPath: string; env: Record<string, string> }> {
  const envPath = path.join(baseRepoPath, envFile);
  const env = await readEnvFile(envPath);
  if (!env.POSTGRES_DATABASE) {
    throw new Error(`Missing POSTGRES_DATABASE in ${envFile}`);
  }
  return { envPath, env };
}

async function ensureEnvFileCopied(
  baseRepoPath: string,
  streamPath: string,
  envFile: string
): Promise<void> {
  const source = path.join(baseRepoPath, envFile);
  const dest = path.join(streamPath, envFile);
  if (await pathExists(dest)) return;
  if (!(await pathExists(source))) {
    throw new Error(`Env file not found in base repo: ${envFile}`);
  }
  await ensureDir(path.dirname(dest));
  await fs.copyFile(source, dest);
}

async function updateStreamEnvFile(
  streamPath: string,
  envFile: string,
  dbName: string
): Promise<void> {
  const envPath = path.join(streamPath, envFile);
  const raw = await readFileIfExists(envPath);
  if (raw === undefined) {
    throw new Error(`Env file not found in stream: ${envFile}`);
  }
  const updated = updateEnvValue(raw, "POSTGRES_DATABASE", dbName);
  await fs.writeFile(envPath, updated, "utf8");
}

export async function cloneDatabase(
  config: StreamConfig,
  streamName: string,
  streamPath: string,
  strategyOverride?: CloneStrategy,
  stdoutToStderr?: boolean
): Promise<CloneResult> {
  ensurePostgresConfig(config);
  const envFile = resolveEnvFile(config);
  const { envPath, env } = await loadDbEnv(config.baseRepoPath, envFile);
  const envPathDisplay = path.relative(config.baseRepoPath, envPath) || envPath;
  const dbEnv: DbEnv = {
    POSTGRES_DATABASE: requireEnv(env, "POSTGRES_DATABASE", envPathDisplay),
    POSTGRES_USER: env.POSTGRES_USER,
    POSTGRES_PASSWORD: env.POSTGRES_PASSWORD,
    POSTGRES_HOST: env.POSTGRES_HOST,
    POSTGRES_PORT: env.POSTGRES_PORT
  };

  const dbName = buildDbName(
    dbEnv.POSTGRES_DATABASE,
    streamName,
    config.db.maxNameLength
  );

  const pgEnv = buildPgEnv(dbEnv);
  const strategy = strategyOverride ?? config.db.cloneStrategy;

  logInfo(`Cloning database to ${dbName}...`);

  if (strategy === "create") {
    await createDatabase(dbName, pgEnv, stdoutToStderr);
  } else if (strategy === "dump") {
    await dumpAndRestore(dbEnv.POSTGRES_DATABASE, dbName, pgEnv, stdoutToStderr);
  } else {
    try {
      await createDatabaseWithTemplate(dbName, dbEnv.POSTGRES_DATABASE, pgEnv, stdoutToStderr);
    } catch (err) {
      logWarn("Template clone failed, falling back to pg_dump/pg_restore.");
      await dumpAndRestore(dbEnv.POSTGRES_DATABASE, dbName, pgEnv, stdoutToStderr);
    }
  }

  await ensureEnvFileCopied(config.baseRepoPath, streamPath, envFile);
  await updateStreamEnvFile(streamPath, envFile, dbName);

  logDebug(`Database clone complete: ${dbName}`);

  return { dbName };
}
