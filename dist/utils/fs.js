"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pathExists = pathExists;
exports.ensureDir = ensureDir;
exports.readJsonFile = readJsonFile;
exports.writeJsonFile = writeJsonFile;
exports.readFileIfExists = readFileIfExists;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
async function pathExists(p) {
    try {
        await fs_1.promises.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function ensureDir(dir) {
    await fs_1.promises.mkdir(dir, { recursive: true });
}
async function readJsonFile(filePath) {
    try {
        const raw = await fs_1.promises.readFile(filePath, "utf8");
        return JSON.parse(raw);
    }
    catch (err) {
        if (err && err.code === "ENOENT")
            return undefined;
        throw err;
    }
}
async function writeJsonFile(filePath, data) {
    const dir = path_1.default.dirname(filePath);
    await ensureDir(dir);
    const tmpPath = `${filePath}.tmp`;
    await fs_1.promises.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    await fs_1.promises.rename(tmpPath, filePath);
}
async function readFileIfExists(filePath) {
    try {
        return await fs_1.promises.readFile(filePath, "utf8");
    }
    catch (err) {
        if (err && err.code === "ENOENT")
            return undefined;
        throw err;
    }
}
