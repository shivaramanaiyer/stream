"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEnv = parseEnv;
exports.readEnvFile = readEnvFile;
exports.updateEnvValue = updateEnvValue;
exports.resolveEnvFileRelPath = resolveEnvFileRelPath;
const path_1 = __importDefault(require("path"));
const fs_1 = require("./utils/fs");
function parseEnv(raw) {
    const result = {};
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        if (!line || line.trim().startsWith("#"))
            continue;
        const idx = line.indexOf("=");
        if (idx === -1)
            continue;
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}
async function readEnvFile(path) {
    const raw = await (0, fs_1.readFileIfExists)(path);
    return raw ? parseEnv(raw) : {};
}
function updateEnvValue(raw, key, value) {
    const lines = raw.split(/\r?\n/);
    let found = false;
    const updated = lines.map((line) => {
        if (line.trim().startsWith("#"))
            return line;
        const idx = line.indexOf("=");
        if (idx === -1)
            return line;
        const existingKey = line.slice(0, idx).trim();
        if (existingKey !== key)
            return line;
        found = true;
        return `${existingKey}=${value}`;
    });
    if (!found)
        updated.push(`${key}=${value}`);
    return updated.join("\n");
}
function resolveEnvFileRelPath(baseRepoPath, envFile) {
    const base = path_1.default.resolve(baseRepoPath);
    const resolved = path_1.default.isAbsolute(envFile)
        ? path_1.default.resolve(envFile)
        : path_1.default.resolve(baseRepoPath, envFile);
    if (resolved === base || resolved.startsWith(`${base}${path_1.default.sep}`)) {
        return path_1.default.relative(base, resolved);
    }
    throw new Error(`Env file must be within base repo: ${envFile}`);
}
