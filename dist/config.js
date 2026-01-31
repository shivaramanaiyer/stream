"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveConfig = resolveConfig;
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const constants_1 = require("./constants");
const strings_1 = require("./utils/strings");
const fs_2 = require("./utils/fs");
const CONFIG_NAME = "stream.config.json";
async function findUp(startDir, filename) {
    let current = path_1.default.resolve(startDir);
    while (true) {
        const candidate = path_1.default.join(current, filename);
        try {
            await fs_1.promises.access(candidate);
            return candidate;
        }
        catch {
            // continue
        }
        const parent = path_1.default.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return undefined;
}
async function inferBaseRepoPath(configDir) {
    const parentDir = path_1.default.dirname(configDir);
    let entries;
    try {
        entries = await fs_1.promises.readdir(parentDir, { withFileTypes: true });
    }
    catch {
        return undefined;
    }
    const statusFiles = entries.filter((entry) => entry.isFile() && entry.name.startsWith(".stream-"));
    for (const entry of statusFiles) {
        const statusPath = path_1.default.join(parentDir, entry.name);
        const status = await (0, fs_2.readJsonFile)(statusPath);
        if (!status || !status.project || !status.streams)
            continue;
        const match = Object.values(status.streams).find((stream) => path_1.default.resolve(stream.path) === configDir);
        if (match) {
            return path_1.default.join(parentDir, status.project);
        }
    }
    return undefined;
}
function resolveNaming(baseRepoPath, config) {
    const defaultSlug = (0, strings_1.slugify)(path_1.default.basename(baseRepoPath));
    return {
        prefix: config?.naming?.prefix ?? "stream",
        slug: config?.naming?.slug ?? defaultSlug
    };
}
async function resolveConfig(cwd) {
    const configPath = await findUp(cwd, CONFIG_NAME);
    const configDir = configPath ? path_1.default.dirname(configPath) : cwd;
    const rawConfig = configPath
        ? ((await (0, fs_2.readJsonFile)(configPath)) ?? {})
        : {};
    let baseRepoPath = rawConfig.baseRepoPath
        ? path_1.default.resolve(configDir, rawConfig.baseRepoPath)
        : path_1.default.resolve(configDir);
    if (!rawConfig.baseRepoPath && configPath) {
        const inferred = await inferBaseRepoPath(path_1.default.resolve(configDir));
        if (inferred)
            baseRepoPath = inferred;
    }
    const streamsRoot = rawConfig.streamsRoot
        ? path_1.default.resolve(configDir, rawConfig.streamsRoot)
        : path_1.default.dirname(baseRepoPath);
    const naming = resolveNaming(baseRepoPath, rawConfig);
    const editor = {
        command: rawConfig.editor?.command ?? constants_1.DEFAULT_EDITOR.command,
        openArgs: rawConfig.editor?.openArgs ?? constants_1.DEFAULT_EDITOR.openArgs
    };
    const setup = {
        enabled: rawConfig.setup?.enabled ?? true,
        steps: rawConfig.setup?.steps ?? constants_1.DEFAULT_SETUP_STEPS
    };
    const db = {
        type: rawConfig.db?.type ?? constants_1.DEFAULT_DB.type,
        cloneStrategy: rawConfig.db?.cloneStrategy ?? constants_1.DEFAULT_DB.cloneStrategy,
        maxNameLength: rawConfig.db?.maxNameLength ?? constants_1.DEFAULT_DB.maxNameLength,
        envFile: rawConfig.db?.envFile ?? constants_1.DEFAULT_DB.envFile
    };
    const copyExcludes = rawConfig.copyExcludes ?? constants_1.DEFAULT_EXCLUDES;
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
