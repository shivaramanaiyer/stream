"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloneDatabase = cloneDatabase;
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const env_1 = require("./env");
const strings_1 = require("./utils/strings");
const exec_1 = require("./utils/exec");
const logger_1 = require("./logger");
const fs_2 = require("./utils/fs");
function buildDbName(base, lane, maxLength) {
    const combined = `${base}__${lane}`;
    return (0, strings_1.sanitizeDbName)(combined, maxLength);
}
function requireEnv(env, key, envPath) {
    const value = env[key];
    if (!value)
        throw new Error(`Missing ${key} in ${envPath}`);
    return value;
}
function buildPgEnv(db) {
    return {
        PGHOST: db.POSTGRES_HOST,
        PGPORT: db.POSTGRES_PORT,
        PGUSER: db.POSTGRES_USER,
        PGPASSWORD: db.POSTGRES_PASSWORD
    };
}
async function runPsql(command, env, stdoutToStderr) {
    const result = await (0, exec_1.runCommand)("psql", ["-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", command], {
        env,
        inheritStdout: true,
        stdoutToStderr
    });
    if (result.code !== 0) {
        throw new Error(`psql failed with code ${result.code}`);
    }
}
async function createDatabase(dbName, env, stdoutToStderr) {
    await runPsql(`CREATE DATABASE \"${dbName}\"`, env, stdoutToStderr);
}
async function createDatabaseWithTemplate(newDb, templateDb, env, stdoutToStderr) {
    await runPsql(`CREATE DATABASE \"${newDb}\" WITH TEMPLATE \"${templateDb}\"`, env, stdoutToStderr);
}
async function dumpAndRestore(sourceDb, targetDb, env, stdoutToStderr) {
    await createDatabase(targetDb, env, stdoutToStderr);
    await new Promise((resolve, reject) => {
        const dump = (0, child_process_1.spawn)("pg_dump", ["-Fc", "-d", sourceDb], {
            env: { ...process.env, ...env },
            stdio: ["ignore", "pipe", "pipe"]
        });
        const restoreStdout = stdoutToStderr ? "pipe" : "inherit";
        const restoreStderr = stdoutToStderr ? "pipe" : "inherit";
        const restore = (0, child_process_1.spawn)("pg_restore", ["-d", targetDb], {
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
        dump.stderr.on("data", (chunk) => {
            dumpError += chunk.toString();
        });
        if (stdoutToStderr && restore.stdout) {
            restore.stdout.on("data", (chunk) => {
                process.stderr.write(chunk);
            });
        }
        if (stdoutToStderr && restore.stderr) {
            restore.stderr.on("data", (chunk) => {
                process.stderr.write(chunk);
            });
        }
        dump.on("error", reject);
        restore.on("error", reject);
        let dumpExit = null;
        let restoreExit = null;
        const finalize = () => {
            if (dumpExit === null || restoreExit === null)
                return;
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
        dump.on("close", (code) => {
            dumpExit = code;
            if (restore.stdin) {
                restore.stdin.end();
            }
            finalize();
        });
        restore.on("close", (code) => {
            restoreExit = code;
            finalize();
        });
    });
}
function ensurePostgresConfig(config) {
    if (config.db.type !== "postgres") {
        throw new Error(`Unsupported db type: ${config.db.type}`);
    }
}
function resolveEnvFile(config) {
    const cleaned = config.db.envFile?.trim();
    if (!cleaned) {
        throw new Error("No env file configured for db clone.");
    }
    return (0, env_1.resolveEnvFileRelPath)(config.baseRepoPath, cleaned);
}
async function loadDbEnv(baseRepoPath, envFile) {
    const envPath = path_1.default.join(baseRepoPath, envFile);
    const env = await (0, env_1.readEnvFile)(envPath);
    if (!env.POSTGRES_DATABASE) {
        throw new Error(`Missing POSTGRES_DATABASE in ${envFile}`);
    }
    return { envPath, env };
}
async function ensureEnvFileCopied(baseRepoPath, streamPath, envFile) {
    const source = path_1.default.join(baseRepoPath, envFile);
    const dest = path_1.default.join(streamPath, envFile);
    if (await (0, fs_2.pathExists)(dest))
        return;
    if (!(await (0, fs_2.pathExists)(source))) {
        throw new Error(`Env file not found in base repo: ${envFile}`);
    }
    await (0, fs_2.ensureDir)(path_1.default.dirname(dest));
    await fs_1.promises.copyFile(source, dest);
}
async function updateStreamEnvFile(streamPath, envFile, dbName) {
    const envPath = path_1.default.join(streamPath, envFile);
    const raw = await (0, fs_2.readFileIfExists)(envPath);
    if (raw === undefined) {
        throw new Error(`Env file not found in stream: ${envFile}`);
    }
    const updated = (0, env_1.updateEnvValue)(raw, "POSTGRES_DATABASE", dbName);
    await fs_1.promises.writeFile(envPath, updated, "utf8");
}
async function cloneDatabase(config, streamName, streamPath, strategyOverride, stdoutToStderr) {
    ensurePostgresConfig(config);
    const envFile = resolveEnvFile(config);
    const { envPath, env } = await loadDbEnv(config.baseRepoPath, envFile);
    const envPathDisplay = path_1.default.relative(config.baseRepoPath, envPath) || envPath;
    const dbEnv = {
        POSTGRES_DATABASE: requireEnv(env, "POSTGRES_DATABASE", envPathDisplay),
        POSTGRES_USER: env.POSTGRES_USER,
        POSTGRES_PASSWORD: env.POSTGRES_PASSWORD,
        POSTGRES_HOST: env.POSTGRES_HOST,
        POSTGRES_PORT: env.POSTGRES_PORT
    };
    const dbName = buildDbName(dbEnv.POSTGRES_DATABASE, streamName, config.db.maxNameLength);
    const pgEnv = buildPgEnv(dbEnv);
    const strategy = strategyOverride ?? config.db.cloneStrategy;
    (0, logger_1.logInfo)(`Cloning database to ${dbName}...`);
    if (strategy === "dump") {
        await dumpAndRestore(dbEnv.POSTGRES_DATABASE, dbName, pgEnv, stdoutToStderr);
    }
    else {
        try {
            await createDatabaseWithTemplate(dbName, dbEnv.POSTGRES_DATABASE, pgEnv, stdoutToStderr);
        }
        catch (err) {
            (0, logger_1.logWarn)("Template clone failed, falling back to pg_dump/pg_restore.");
            await dumpAndRestore(dbEnv.POSTGRES_DATABASE, dbName, pgEnv, stdoutToStderr);
        }
    }
    await ensureEnvFileCopied(config.baseRepoPath, streamPath, envFile);
    await updateStreamEnvFile(streamPath, envFile, dbName);
    (0, logger_1.logDebug)(`Database clone complete: ${dbName}`);
    return { dbName };
}
