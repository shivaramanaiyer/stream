"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusFilePath = statusFilePath;
exports.readStatus = readStatus;
exports.writeStatus = writeStatus;
exports.upsertStream = upsertStream;
exports.updateStreamStatus = updateStreamStatus;
const path_1 = __importDefault(require("path"));
const strings_1 = require("./utils/strings");
const fs_1 = require("./utils/fs");
function statusFilePath(baseRepoPath) {
    const project = path_1.default.basename(baseRepoPath);
    return path_1.default.join(path_1.default.dirname(baseRepoPath), `.stream-${project}`);
}
async function readStatus(baseRepoPath) {
    const filePath = statusFilePath(baseRepoPath);
    const existing = await (0, fs_1.readJsonFile)(filePath);
    if (existing)
        return existing;
    return {
        project: path_1.default.basename(baseRepoPath),
        updatedAt: (0, strings_1.nowIso)(),
        streams: {}
    };
}
async function writeStatus(baseRepoPath, status) {
    status.updatedAt = (0, strings_1.nowIso)();
    await (0, fs_1.writeJsonFile)(statusFilePath(baseRepoPath), status);
}
async function upsertStream(baseRepoPath, info) {
    const status = await readStatus(baseRepoPath);
    status.streams[info.name] = info;
    status.lastActive = info.name;
    await writeStatus(baseRepoPath, status);
}
async function updateStreamStatus(baseRepoPath, streamName, statusValue) {
    const status = await readStatus(baseRepoPath);
    const existing = status.streams[streamName];
    if (!existing)
        return;
    existing.status = statusValue;
    status.lastActive = streamName;
    await writeStatus(baseRepoPath, status);
}
